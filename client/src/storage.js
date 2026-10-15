let connection;
const sequences = new Map();
function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const req = indexedDB.open("trailway-local", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("records");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return connection;
}
export async function read(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly"),
      req = tx.objectStore("records").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function write(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export const empty = () => ({ routes: [], queue: [], trackQueue: [] });
export async function load(scope) {
  return (await read("scope:" + scope)) || empty();
}
export function mutate(scope, fn) {
  const prev = sequences.get(scope) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const data = await load(scope);
      const result = await fn(data);
      await write("scope:" + scope, data);
      return result ?? data;
    });
  sequences.set(scope, next);
  return next;
}
export async function mergeRemote(scope, remote) {
  return mutate(scope, (data) => {
    const pending = new Set(data.queue.map((op) => op.entity_id));
    data.routes = [
      ...remote.filter((r) => !pending.has(r.id)),
      ...data.routes.filter((r) => pending.has(r.id)),
    ];
  });
}
export async function saveLocal(scope, route, isNew) {
  return mutate(scope, (data) => {
    const old = data.routes.find((r) => r.id === route.id);
    const next = {
      ...route,
      local: true,
      updated_at: new Date().toISOString(),
      version: isNew ? 1 : (old?.version || 1) + 1,
    };
    data.routes = [next, ...data.routes.filter((r) => r.id !== route.id)];
    data.queue.push({
      client_operation_id: crypto.randomUUID(),
      entity_id: route.id,
      operation_type: isNew ? "create" : "update",
      ...(isNew ? {} : { base_version: old?.version || 1 }),
      payload: {
        name: route.name,
        description: route.description,
        state: route.state,
        points: route.points,
      },
    });
    return next;
  });
}
export async function removeLocal(scope, id) {
  return mutate(scope, (data) => {
    const old = data.routes.find((r) => r.id === id);
    if (
      data.queue.some(
        (op) => op.entity_id === id && op.operation_type === "create",
      )
    )
      data.queue = data.queue.filter((op) => op.entity_id !== id);
    else
      data.queue.push({
        client_operation_id: crypto.randomUUID(),
        entity_id: id,
        operation_type: "delete",
        base_version: old?.version || 1,
      });
    data.routes = data.routes.filter((r) => r.id !== id);
  });
}
export async function importGuests(owner) {
  const guest = await load("guest");
  if (!guest.routes.length) return;
  await mutate(owner, (data) => {
    for (const r of guest.routes)
      if (!data.routes.some((x) => x.id === r.id)) {
        data.routes.push({ ...r, version: 1 });
        data.queue.push({
          client_operation_id: crypto.randomUUID(),
          entity_id: r.id,
          operation_type: "create",
          payload: {
            name: r.name,
            description: r.description,
            state: r.state,
            points: r.points,
          },
        });
      }
  });
  await write("scope:guest", empty());
}
export async function synchronize(scope, api) {
  let data = await load(scope);
  const blocked = new Set(
    data.queue.filter((op) => op.error).map((op) => op.entity_id),
  );
  for (const operation of data.queue) {
    if (blocked.has(operation.entity_id)) continue;
    const request = { ...operation };
    delete request.error;
    const response = await api("/sync", {
        method: "POST",
        body: { operations: [request] },
      }),
      result = response.results[0];
    if (result.status !== "applied") blocked.add(operation.entity_id);
    await mutate(scope, (current) => {
      const op = current.queue.find(
        (x) => x.client_operation_id === operation.client_operation_id,
      );
      if (!op) return;
      if (result.status === "applied")
        current.queue = current.queue.filter((x) => x !== op);
      else
        op.error =
          result.message || "Конфлікт версій. Завантажте серверну копію.";
    });
  }
  data = await load(scope);
  for (const group of data.trackQueue) {
    await api(`/trips/${group.trip_id}/track`, {
      method: "POST",
      body: { points: group.points },
    });
    await mutate(scope, (current) => {
      current.trackQueue = current.trackQueue.filter((x) => x.id !== group.id);
    });
  }
  return load(scope);
}
