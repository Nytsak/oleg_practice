import { ApiError, requireValue, publicError } from "./errors.js";
import { object, uuid } from "./validation.js";
import { hashOperation, hashToken } from "./security.js";
import { createRoute, updateRoute, deleteRoute } from "./routes-service.js";

// One transaction per operation; a savepoint keeps the idempotency journal.
export async function synchronizeRoutes(db, owner, operations) {
  requireValue(
    Array.isArray(operations) &&
      operations.length >= 1 &&
      operations.length <= 50,
    "Надішліть від 1 до 50 операцій.",
  );
  // Validate every envelope before applying any operation in the batch.
  for (const op of operations) {
    object(op, "operations[]");
    uuid(op.client_operation_id, "client_operation_id");
    uuid(op.entity_id, "entity_id");
    requireValue(
      ["create", "update", "delete"].includes(op.operation_type),
      "Невідома операція синхронізації.",
    );
  }
  const results = [];
  for (const op of operations) {
    const requestHash = hashOperation(op);
    const result = await db.transaction(async (tx) => {
      // Serializes one user's sync stream, including retries from different devices.
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        owner,
      ]);
      const existing = (
        await tx.query(
          "SELECT * FROM sync_operations WHERE user_id=$1 AND client_operation_id=$2",
          [owner, op.client_operation_id],
        )
      ).rows[0];
      if (existing) {
        // Also recognize exact retries from the original journal format.
        if (
          existing.request_hash !== requestHash &&
          existing.request_hash !== hashToken(JSON.stringify(op))
        )
          throw new ApiError(
            409,
            "Ідентифікатор операції вже використано для інших даних.",
          );
        return { ...existing.response, replayed: true };
      }
      let response;
      // Savepoint keeps business errors from aborting the idempotency journal transaction.
      await tx.query("SAVEPOINT sync_change");
      try {
        let route = null;
        if (op.operation_type === "create")
          route = await createRoute(
            tx,
            owner,
            op.payload,
            op.entity_id,
          );
        if (op.operation_type === "update")
          route = await updateRoute(tx, owner, op.entity_id, {
            ...op.payload,
            base_version: op.base_version,
          });
        if (op.operation_type === "delete")
          await deleteRoute(tx, owner, op.entity_id, op.base_version);
        response = {
          client_operation_id: op.client_operation_id,
          status: "applied",
          route,
        };
        await tx.query("RELEASE SAVEPOINT sync_change");
      } catch (e) {
        await tx.query("ROLLBACK TO SAVEPOINT sync_change");
        if (!e.status && !["23503", "23505", "23514"].includes(e.code))
          throw e;
        const failure = publicError(e);
        response = {
          client_operation_id: op.client_operation_id,
          status: failure.status === 409 ? "conflict" : "failed",
          message: failure.message,
          fields: failure.fields,
        };
      }
      await tx.query(
        "INSERT INTO sync_operations(user_id,client_operation_id,entity_type,entity_id,operation_type,base_version,result_version,status,processed_at,response,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10)",
        [
          owner,
          op.client_operation_id,
          "route",
          op.entity_id,
          op.operation_type,
          op.base_version ?? null,
          response.route?.version ?? null,
          response.status,
          JSON.stringify(response),
          requestHash,
        ],
      );
      return response;
    });
    results.push(result);
  }
  return { results };
}
