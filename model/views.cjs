// R5-specific view membership and placement preferences. These do not change
// class identity, relation direction, stereotypes, or multiplicities.
module.exports = {
  runtime: {
    label: "Game server",
    title: "R5 game-server runtime",
    packages: ["runtime", "shared"],
    includeNames: [],
    focusNames: ["GameServer", "ClientSlot", "GameSession"],
    columns: [
      [
        "GameSession",
        "ClientSlot",
        "AssignedPlayerEntity",
        "Respawn",
        "CommandProcessing",
        "ClientApplication",
        "Downing",
      ],
      [
        "PlayerEntity",
        "GameServer",
        "SessionParticipant",
        "NetworkChannel",
        "Snapshot",
        "EliminationStatus",
      ],
      [
        "MatchSquad",
        "ServerFrame",
        "PlatformIdentity",
        "SessionParticipation",
        "SnapshotEmission",
        "AvatarAssignment",
        "ReadyPlayer",
        "DownedPlayer",
      ],
      [
        "EliminatedIdentity",
        "GameStateChange",
        "GameMatch",
        "InputCommand",
        "PlaylistConfig",
        "ActiveClientSlot",
        "ClientReplicationState",
      ],
    ],
  },
  backend: {
    label: "Server browser",
    title: "R5 server discovery and publication",
    packages: ["backend"],
    includeNames: ["GameServer", "ClientApplication"],
    focusNames: ["DirectoryService", "ListingPublication", "ServerListing"],
    columns: [
      ["DirectoryService", "ClientApplication", "ServerListing"],
      [
        "ListingPublication",
        "ServerLookup",
        "ListingUpdate",
        "HiddenListing",
        "PublicListing",
      ],
      ["PublishedListing", "GameServer"],
    ],
  },
};
