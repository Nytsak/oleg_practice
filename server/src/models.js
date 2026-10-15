// Domain entities map directly to the PostgreSQL schema. JSDoc keeps the plain
// JavaScript project runnable without a TypeScript compilation step or ORM.
/** @typedef {{id:string,email:string,password_hash:string,display_name:string,role:'tourist'|'admin',created_at:Date}} User */
/** @typedef {{id:number,code:string,name:string}} PlaceCategory */
/** @typedef {{id:string,category_id:number,created_by:string|null,name:string,description:string,latitude:number,longitude:number,is_visible:boolean}} TouristPlace */
/** @typedef {{id:string,route_id:string,place_id:string|null,position:number,label_snapshot:string,latitude:number,longitude:number}} RoutePoint */
/** @typedef {{id:string,owner_id:string,name:string,description:string,state:'draft'|'ready',version:number,geometry:Object,distance_m:number,duration_s:number,points:RoutePoint[]}} Route */
/** @typedef {{id:string,owner_id:string,route_id:string|null,route_snapshot:Route,state:'active'|'paused'|'finished',started_at:Date,finished_at:Date|null,active_duration_s:number,distance_m:number}} Trip */
/** @typedef {{id:number,trip_id:string,segment_id:string,recorded_at:Date,latitude:number,longitude:number,accuracy_m:number}} TrackPoint */
/** @typedef {{id:string,route_id:string,token_hash:string,expires_at:Date|null,revoked_at:Date|null}} ShareLink */
/** @typedef {{id:string,user_id:string,client_operation_id:string,entity_type:'route',entity_id:string,operation_type:'create'|'update'|'delete',base_version:number|null,status:'pending'|'applied'|'conflict'|'failed',response:Object}} SyncOperation */
export const UserRole = Object.freeze({ TOURIST: "tourist", ADMIN: "admin" });
export const RouteState = Object.freeze({ DRAFT: "draft", READY: "ready" });
export const TripState = Object.freeze({ ACTIVE: "active", PAUSED: "paused", FINISHED: "finished" });
