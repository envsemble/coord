# R5 Season 3 service domain

The vocabulary of the current source-informed model. Source observations and proposed ontological boundaries are distinguished in `model/model.cjs` and `model/source-evidence.json`.

## Language

**Game server**:
An engine-side server resource with client slots, tick state, and a current level context.
_Avoid_: Game session, hosting process, server listing

**Game session**:
A proposed identity for the current game context and roster. Its exact native identity and lifecycle remain unresolved.
_Avoid_: Game match, server resource

**Game match**:
The gameplay occurrence associated with a game session.
_Avoid_: Game session

**Client slot**:
A server-owned CClient resource that can be reused across connection lifecycles.
_Avoid_: Client application, platform identity, player entity

**Client application**:
The remote game application as a runtime resource.
_Avoid_: CClient, client slot

**Platform identity**:
A persona identity distinguished by platform UID, separate from slot-local IDs and entity handles.
_Avoid_: Current user ID, entity ID

**Session participant**:
A client slot in the dependent role of belonging to one game session.
_Avoid_: Permanent player identity, network connection

**Player entity**:
An identified character entity. A reused script reference supports limited respawn continuity; native allocation remains unresolved.
_Avoid_: Platform identity, client slot, legend definition

**Match squad**:
A session-scoped team roster represented through team numbers and team operations.
_Avoid_: Prematch party

**Elimination status**:
A session-specific relationship recorded for a platform UID, which can be cleared on respawn.
_Avoid_: Dead entity, downed entity

**Snapshot**:
A simulation-state information artifact whose native layout and contents are only partially identified.
_Avoid_: Network packet, server frame, live world

**Server listing**:
An advertisement describing a server for discovery.
_Avoid_: Game server, matchmaking allocation

**Directory service**:
The opaque Pylon service reached by the inspected listing API client.
_Avoid_: EA skill matchmaker, game server
