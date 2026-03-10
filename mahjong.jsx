import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Copy, Check, ChevronDown, ChevronUp, Trophy, RotateCcw, Users, Eye, EyeOff, X, AlertTriangle } from "lucide-react";

// ============================================================
// MOBILE DETECTION HOOK
// ============================================================

function useIsMobile(breakpoint = 600) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ============================================================
// TILE DATA MODEL
// ============================================================

const SUITS = { BAMBOO: "bamboo", CHARACTER: "character", DOT: "dot" };
const WINDS = ["East", "South", "West", "North"];
const DRAGONS = ["Red", "Green", "White"];

const SUIT_LABELS = { bamboo: "竹", character: "萬", dot: "筒" };
const DRAGON_LABELS = { Red: "中", Green: "發", White: "白" };
const WIND_LABELS = { East: "東", South: "南", West: "西", North: "北" };

// Unicode mahjong tile chars (U+1F000 range) - we'll use styled text instead for reliability
const TILE_COLORS = {
  bamboo: "#2d8a4e",
  character: "#c0392b",
  dot: "#2874a6",
  wind: "#4a4a4a",
  dragon_Red: "#c0392b",
  dragon_Green: "#2d8a4e",
  dragon_White: "#6c757d",
  bonus: "#c9a94e",
};

function createTileSet(includeBonuses) {
  const tiles = [];
  let id = 0;

  // Suited tiles: 1-9 x4 for each suit
  for (const suit of Object.values(SUITS)) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({
          id: id++,
          type: "suit",
          suit,
          value,
          label: `${value}${SUIT_LABELS[suit]}`,
          sortKey: ({ bamboo: 0, character: 100, dot: 200 }[suit]) + value,
        });
      }
    }
  }

  // Wind tiles x4
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id: id++,
        type: "wind",
        suit: "wind",
        value: wind,
        label: WIND_LABELS[wind],
        sortKey: 300 + WINDS.indexOf(wind),
      });
    }
  }

  // Dragon tiles x4
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id: id++,
        type: "dragon",
        suit: "dragon",
        value: dragon,
        label: DRAGON_LABELS[dragon],
        sortKey: 400 + DRAGONS.indexOf(dragon),
      });
    }
  }

  // Bonus tiles
  if (includeBonuses) {
    const flowers = ["梅", "蘭", "菊", "竹"];
    const seasons = ["春", "夏", "秋", "冬"];
    for (let i = 0; i < 4; i++) {
      tiles.push({
        id: id++,
        type: "flower",
        suit: "bonus",
        value: `F${i + 1}`,
        label: flowers[i],
        sortKey: 500 + i,
      });
    }
    for (let i = 0; i < 4; i++) {
      tiles.push({
        id: id++,
        type: "season",
        suit: "bonus",
        value: `S${i + 1}`,
        label: seasons[i],
        sortKey: 600 + i,
      });
    }
  }

  return tiles;
}

// Fisher-Yates shuffle
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortHand(hand) {
  return [...hand].sort((a, b) => a.sortKey - b.sortKey);
}

function tileMatchesId(tile, id) {
  return tile.id === id;
}

function tilesMatch(a, b) {
  return a.type === b.type && a.suit === b.suit && a.value === b.value;
}

function countMatchingTiles(tiles, ref) {
  return tiles.filter((t) => tilesMatch(t, ref)).length;
}

// ============================================================
// GAME LOGIC
// ============================================================

const PHASES = {
  LOBBY: "lobby",
  TURN_TRANSITION: "turn_transition",
  DRAW: "draw",
  ACTION: "action",
  CLAIM: "claim",
  GAME_OVER: "game_over",
  ROUND_OVER: "round_over",
};

function createInitialState(playerNames, includeBonuses) {
  const allTiles = createTileSet(includeBonuses);
  const shuffled = shuffle(allTiles);
  const numPlayers = playerNames.length;

  // Deal 13 tiles each (14 to dealer)
  const players = playerNames.map((name, i) => ({
    name,
    hand: [],
    melds: [],
    score: 0,
    bonusTiles: [],
    skipNextTurn: false,
  }));

  let wallIndex = 0;
  for (let i = 0; i < numPlayers; i++) {
    const count = i === 0 ? 14 : 13;
    players[i].hand = sortHand(shuffled.slice(wallIndex, wallIndex + count));
    wallIndex += count;
  }

  // Handle bonus tiles in initial hands
  for (let i = 0; i < numPlayers; i++) {
    let replaced = true;
    while (replaced) {
      replaced = false;
      const bonusInHand = players[i].hand.filter(
        (t) => t.type === "flower" || t.type === "season"
      );
      if (bonusInHand.length > 0) {
        for (const bt of bonusInHand) {
          players[i].hand = players[i].hand.filter((t) => t.id !== bt.id);
          players[i].bonusTiles.push(bt);
          if (wallIndex < shuffled.length - 14) {
            players[i].hand.push(shuffled[wallIndex]);
            wallIndex++;
            replaced = true;
          }
        }
        players[i].hand = sortHand(players[i].hand);
      }
    }
  }

  const deadWall = shuffled.slice(shuffled.length - 14);
  const wall = shuffled.slice(wallIndex, shuffled.length - 14);

  return {
    players,
    wall,
    deadWall,
    discardPool: [],
    currentTurn: 0,
    dealer: 0,
    round: 1,
    phase: PHASES.TURN_TRANSITION,
    lastDiscard: null,
    lastDiscardPlayer: null,
    pendingClaims: [],
    includeBonuses,
    prevailingWind: 0, // index into WINDS
    drawnTile: null, // the tile just drawn, shown separately
    winner: null,
    winType: null,
    gameLog: [],
    falseDeclarations: {}, // playerId -> count
  };
}

function drawTile(state) {
  if (state.wall.length === 0) {
    return { ...state, phase: PHASES.ROUND_OVER, winner: null };
  }
  const newWall = [...state.wall];
  const tile = newWall.shift();
  const newPlayers = state.players.map((p, i) => {
    if (i === state.currentTurn) {
      return { ...p, hand: [...p.hand, tile] };
    }
    return p;
  });

  let result = {
    ...state,
    wall: newWall,
    players: newPlayers,
    phase: PHASES.ACTION,
    drawnTile: tile,
  };

  // Handle bonus tile draws
  if (tile.type === "flower" || tile.type === "season") {
    const player = result.players[state.currentTurn];
    result = {
      ...result,
      players: result.players.map((p, i) => {
        if (i === state.currentTurn) {
          return {
            ...p,
            hand: p.hand.filter((t) => t.id !== tile.id),
            bonusTiles: [...p.bonusTiles, tile],
          };
        }
        return p;
      }),
      drawnTile: null,
    };
    // Draw replacement from dead wall
    if (result.deadWall.length > 0) {
      const replacement = result.deadWall[0];
      result = {
        ...result,
        deadWall: result.deadWall.slice(1),
        players: result.players.map((p, i) => {
          if (i === state.currentTurn) {
            return { ...p, hand: sortHand([...p.hand, replacement]) };
          }
          return p;
        }),
        drawnTile: replacement,
      };
      // Recurse if replacement is also a bonus
      if (replacement.type === "flower" || replacement.type === "season") {
        return drawTile(result);
      }
    }
  }

  return result;
}

function discardTile(state, tileId) {
  const player = state.players[state.currentTurn];
  const tile = player.hand.find((t) => t.id === tileId);
  if (!tile) return state;

  const newPlayers = state.players.map((p, i) => {
    if (i === state.currentTurn) {
      return {
        ...p,
        hand: sortHand(p.hand.filter((t) => t.id !== tileId)),
      };
    }
    return p;
  });

  return {
    ...state,
    players: newPlayers,
    discardPool: [...state.discardPool, tile],
    lastDiscard: tile,
    lastDiscardPlayer: state.currentTurn,
    phase: PHASES.CLAIM,
    drawnTile: null,
  };
}

function getNextPlayer(state) {
  const num = state.players.length;
  let next = (state.currentTurn + 1) % num;
  // Skip players who are penalized
  if (state.players[next].skipNextTurn) {
    return next; // We'll clear the skip when they actually get their turn
  }
  return next;
}

function advanceTurn(state) {
  const num = state.players.length;
  let next = (state.currentTurn + 1) % num;
  const newPlayers = [...state.players];

  if (newPlayers[next].skipNextTurn) {
    newPlayers[next] = { ...newPlayers[next], skipNextTurn: false };
    next = (next + 1) % num;
  }

  return {
    ...state,
    players: newPlayers,
    currentTurn: next,
    phase: PHASES.TURN_TRANSITION,
    lastDiscard: null,
    lastDiscardPlayer: null,
    drawnTile: null,
  };
}

// ============================================================
// CLAIM / MELD VALIDATION
// ============================================================

function canChow(playerHand, discardTile, playerIndex, discardPlayerIndex, numPlayers) {
  // Chow only from the player whose turn is right before yours
  if ((discardPlayerIndex + 1) % numPlayers !== playerIndex) return false;
  if (discardTile.type !== "suit") return false;

  const suitTiles = playerHand.filter((t) => t.suit === discardTile.suit);
  const vals = suitTiles.map((t) => t.value);
  const v = discardTile.value;

  const combos = [];
  // Check all possible chow combinations
  if (vals.includes(v - 2) && vals.includes(v - 1)) combos.push([v - 2, v - 1, v]);
  if (vals.includes(v - 1) && vals.includes(v + 1)) combos.push([v - 1, v, v + 1]);
  if (vals.includes(v + 1) && vals.includes(v + 2)) combos.push([v, v + 1, v + 2]);

  return combos.length > 0 ? combos : false;
}

function getChowCombos(playerHand, discardTile) {
  if (discardTile.type !== "suit") return [];
  const suitTiles = playerHand.filter((t) => t.suit === discardTile.suit);
  const vals = suitTiles.map((t) => t.value);
  const v = discardTile.value;
  const combos = [];
  if (vals.includes(v - 2) && vals.includes(v - 1)) combos.push([v - 2, v - 1]);
  if (vals.includes(v - 1) && vals.includes(v + 1)) combos.push([v - 1, v + 1]);
  if (vals.includes(v + 1) && vals.includes(v + 2)) combos.push([v + 1, v + 2]);
  return combos;
}

function canPung(playerHand, discardTile) {
  return countMatchingTiles(playerHand, discardTile) >= 2;
}

function canKong(playerHand, discardTile) {
  return countMatchingTiles(playerHand, discardTile) >= 3;
}

function canConcealedKong(playerHand) {
  const counts = {};
  for (const t of playerHand) {
    const key = `${t.type}_${t.suit}_${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const kongs = [];
  for (const [key, count] of Object.entries(counts)) {
    if (count === 4) {
      const tile = playerHand.find(
        (t) => `${t.type}_${t.suit}_${t.value}` === key
      );
      kongs.push(tile);
    }
  }
  return kongs;
}

function canAddToKong(playerHand, melds) {
  // Can promote an exposed pung to a kong
  const results = [];
  for (const meld of melds) {
    if (meld.type === "pung") {
      const matching = playerHand.find((t) => tilesMatch(t, meld.tiles[0]));
      if (matching) results.push({ meld, tile: matching });
    }
  }
  return results;
}

// ============================================================
// HAND VALIDATION & SCORING
// ============================================================

function isValidWinningHand(hand, melds) {
  // Total tiles should be 14 (including melds)
  // melds contribute: chow=3, pung=3, kong=4
  const meldTileCount = melds.reduce(
    (sum, m) => sum + (m.type === "kong" ? 4 : 3),
    0
  );
  const totalSets = melds.length;
  const neededSets = 4 - totalSets;
  const neededTiles = neededSets * 3 + 2; // sets of 3 + 1 pair

  if (hand.length !== neededTiles) return false;

  return canFormSetsAndPair(hand, neededSets);
}

function canFormSetsAndPair(tiles, neededSets) {
  if (tiles.length === 0 && neededSets === 0) return true;
  if (tiles.length === 2 && neededSets === 0) {
    return tilesMatch(tiles[0], tiles[1]);
  }
  if (tiles.length < 2) return false;

  const sorted = sortHand(tiles);

  // Try using first tile as part of a pair
  for (let i = 1; i < sorted.length; i++) {
    if (tilesMatch(sorted[0], sorted[i])) {
      const remaining = [...sorted.slice(1, i), ...sorted.slice(i + 1)];
      if (canFormSets(remaining, neededSets)) return true;
      break; // Only need to try one pair with the same tile
    }
  }

  // Try using first tile as part of a set
  if (canFormSetsWithFirst(sorted, neededSets)) return true;

  return false;
}

function canFormSets(tiles, needed) {
  if (needed === 0 && tiles.length === 0) return true;
  if (tiles.length < 3 || needed === 0) return false;

  const sorted = sortHand(tiles);

  // Try pung with first tile
  if (
    sorted.length >= 3 &&
    tilesMatch(sorted[0], sorted[1]) &&
    tilesMatch(sorted[0], sorted[2])
  ) {
    if (canFormSets(sorted.slice(3), needed - 1)) return true;
  }

  // Try chow with first tile
  if (sorted[0].type === "suit") {
    const v = sorted[0].value;
    const s = sorted[0].suit;
    const idx1 = sorted.findIndex(
      (t, i) => i > 0 && t.type === "suit" && t.suit === s && t.value === v + 1
    );
    if (idx1 > 0) {
      const idx2 = sorted.findIndex(
        (t, i) =>
          i > idx1 && t.type === "suit" && t.suit === s && t.value === v + 2
      );
      if (idx2 > 0) {
        const remaining = sorted.filter(
          (_, i) => i !== 0 && i !== idx1 && i !== idx2
        );
        if (canFormSets(remaining, needed - 1)) return true;
      }
    }
  }

  return false;
}

function canFormSetsWithFirst(sorted, neededSets) {
  if (neededSets === 0) return sorted.length === 2 && tilesMatch(sorted[0], sorted[1]);
  if (sorted.length < 3 + 2) return false; // need at least 1 set + pair

  // Try pung
  if (tilesMatch(sorted[0], sorted[1]) && tilesMatch(sorted[0], sorted[2])) {
    const rem = sorted.slice(3);
    if (canFormSetsAndPair(rem, neededSets - 1)) return true;
  }

  // Try chow
  if (sorted[0].type === "suit") {
    const v = sorted[0].value;
    const s = sorted[0].suit;
    const idx1 = sorted.findIndex(
      (t, i) => i > 0 && t.suit === s && t.value === v + 1
    );
    if (idx1 > 0) {
      const idx2 = sorted.findIndex(
        (t, i) => i > idx1 && t.suit === s && t.value === v + 2
      );
      if (idx2 > 0) {
        const remaining = sorted.filter(
          (_, i) => i !== 0 && i !== idx1 && i !== idx2
        );
        if (canFormSetsAndPair(remaining, neededSets - 1)) return true;
          }
    }
  }

  return false;
}

function canWinWithTile(hand, melds, tile) {
  const testHand = sortHand([...hand, tile]);
  return isValidWinningHand(testHand, melds);
}

function canDeclareWin(hand, melds) {
  return isValidWinningHand(hand, melds);
}

function scoreHand(player, isSelfDrawn, prevailingWind, seatWind) {
  const allTiles = [
    ...player.hand,
    ...player.melds.flatMap((m) => m.tiles),
  ];
  const melds = player.melds;
  const hand = player.hand;

  let points = 1; // chicken hand base
  let labels = ["Chicken Hand"];

  // All pungs (no chows, all melds are pung or kong)
  const allMelds = [...melds];
  // Check hand tiles form pungs + pair
  const handPungs = checkAllPungs(hand, melds);
  if (handPungs) {
    points = Math.max(points, 2);
    labels = ["All Pungs"];
  }

  // All one suit
  const suits = new Set(allTiles.filter((t) => t.type === "suit").map((t) => t.suit));
  const hasHonors = allTiles.some((t) => t.type === "wind" || t.type === "dragon");
  if (suits.size === 1 && !hasHonors) {
    points = Math.max(points, 4);
    labels = ["All One Suit"];
  }

  // All honors
  if (allTiles.every((t) => t.type === "wind" || t.type === "dragon")) {
    points = Math.max(points, 8);
    labels = ["All Honours"];
  }

  // Half flush (one suit + honors only)
  if (suits.size === 1 && hasHonors) {
    points = Math.max(points, 3);
    if (points === 3) labels = ["Half Flush"];
  }

  if (isSelfDrawn) {
    points += 1;
    labels.push("Self-Drawn +1");
  }

  // Bonus tiles
  const bonusPoints = player.bonusTiles ? player.bonusTiles.length : 0;
  if (bonusPoints > 0) {
    points += bonusPoints;
    labels.push(`Bonus Tiles +${bonusPoints}`);
  }

  return { points, labels };
}

function checkAllPungs(hand, melds) {
  // All melds must be pung or kong
  if (melds.some((m) => m.type === "chow")) return false;

  // Remaining hand tiles must form pungs + pair
  const sorted = sortHand(hand);
  return canFormAllPungs(sorted);
}

function canFormAllPungs(tiles) {
  if (tiles.length === 2) return tilesMatch(tiles[0], tiles[1]);
  if (tiles.length < 2) return false;

  // Try pair first
  for (let i = 1; i < tiles.length; i++) {
    if (tilesMatch(tiles[0], tiles[i])) {
      const rem = [...tiles.slice(1, i), ...tiles.slice(i + 1)];
      if (canFormAllPungsHelper(rem)) return true;
      break;
    }
  }

  // Try pung first
  if (
    tiles.length >= 3 &&
    tilesMatch(tiles[0], tiles[1]) &&
    tilesMatch(tiles[0], tiles[2])
  ) {
    if (canFormAllPungs(tiles.slice(3))) return true;
  }

  return false;
}

function canFormAllPungsHelper(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length < 3) return false;
  if (tilesMatch(tiles[0], tiles[1]) && tilesMatch(tiles[0], tiles[2])) {
    return canFormAllPungsHelper(tiles.slice(3));
  }
  return false;
}

// ============================================================
// STATE SERIALISATION
// ============================================================

function encodeState(state) {
  const compact = {
    p: state.players.map((p) => ({
      n: p.name,
      h: p.hand.map((t) => t.id),
      m: p.melds.map((m) => ({
        t: m.type,
        i: m.tiles.map((t) => t.id),
        c: m.concealed || false,
      })),
      s: p.score,
      b: p.bonusTiles ? p.bonusTiles.map((t) => t.id) : [],
      sk: p.skipNextTurn || false,
    })),
    w: state.wall.map((t) => t.id),
    dw: state.deadWall.map((t) => t.id),
    dp: state.discardPool.map((t) => t.id),
    ct: state.currentTurn,
    d: state.dealer,
    r: state.round,
    ph: state.phase,
    ld: state.lastDiscard ? state.lastDiscard.id : null,
    ldp: state.lastDiscardPlayer,
    ib: state.includeBonuses,
    pw: state.prevailingWind,
    dt: state.drawnTile ? state.drawnTile.id : null,
    fd: state.falseDeclarations || {},
  };

  const json = JSON.stringify(compact);
  return btoa(
    encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  );
}

function decodeState(code) {
  try {
    const json = decodeURIComponent(
      Array.from(atob(code))
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const compact = JSON.parse(json);

    // Rebuild tile lookup
    const allTiles = createTileSet(compact.ib);
    const tileMap = {};
    for (const t of allTiles) tileMap[t.id] = t;

    const lookup = (id) => tileMap[id];
    const lookupArr = (ids) => ids.map(lookup).filter(Boolean);

    const state = {
      players: compact.p.map((p) => ({
        name: p.n,
        hand: sortHand(lookupArr(p.h)),
        melds: p.m.map((m) => ({
          type: m.t,
          tiles: lookupArr(m.i),
          concealed: m.c || false,
        })),
        score: p.s,
        bonusTiles: lookupArr(p.b || []),
        skipNextTurn: p.sk || false,
      })),
      wall: lookupArr(compact.w),
      deadWall: lookupArr(compact.dw),
      discardPool: lookupArr(compact.dp),
      currentTurn: compact.ct,
      dealer: compact.d,
      round: compact.r,
      phase: compact.ph,
      lastDiscard: compact.ld != null ? lookup(compact.ld) : null,
      lastDiscardPlayer: compact.ldp,
      includeBonuses: compact.ib,
      prevailingWind: compact.pw,
      drawnTile: compact.dt != null ? lookup(compact.dt) : null,
      winner: null,
      winType: null,
      gameLog: [],
      pendingClaims: [],
      falseDeclarations: compact.fd || {},
    };

    // Validate
    if (!state.players || state.players.length < 2) throw new Error("Invalid");
    return state;
  } catch (e) {
    return null;
  }
}

// ============================================================
// COMPONENTS
// ============================================================

// --- Tile Component ---
function Tile({ tile, onClick, selected, faceDown, small, disabled, highlighted, mobile }) {
  // Tile sizes: small (melds/discards), normal (hand), adjusted for mobile
  const w = small ? (mobile ? 28 : 32) : (mobile ? 38 : 44);
  const h = small ? (mobile ? 38 : 44) : (mobile ? 52 : 60);

  if (faceDown) {
    return (
      <div
        style={{
          width: w,
          height: h,
          background: "linear-gradient(135deg, #1a5c3a 0%, #0d3320 100%)",
          borderRadius: 6,
          border: "2px solid #2d8a4e",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 2,
          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: small ? 20 : 28,
            height: small ? 28 : 38,
            border: "1px solid #3a7a55",
            borderRadius: 3,
          }}
        />
      </div>
    );
  }

  const getTileColor = () => {
    if (tile.type === "suit") return TILE_COLORS[tile.suit];
    if (tile.type === "wind") return TILE_COLORS.wind;
    if (tile.type === "dragon") return TILE_COLORS[`dragon_${tile.value}`];
    return TILE_COLORS.bonus;
  };

  const getSubLabel = () => {
    if (tile.type === "suit") return tile.suit.charAt(0).toUpperCase();
    if (tile.type === "wind") return tile.value;
    if (tile.type === "dragon") return tile.value;
    if (tile.type === "flower") return "花";
    if (tile.type === "season") return "季";
    return "";
  };

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        width: w,
        height: h,
        background: selected
          ? "linear-gradient(180deg, #fff8dc 0%, #f0e6b8 100%)"
          : "linear-gradient(180deg, #fefdf5 0%, #f0ead6 100%)",
        borderRadius: 6,
        border: selected
          ? "2px solid #c9a94e"
          : highlighted
          ? "2px solid #c9a94e"
          : "2px solid #d4c9a8",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        margin: mobile ? 1 : 2,
        cursor: disabled ? "default" : onClick ? "pointer" : "default",
        boxShadow: selected
          ? "0 4px 12px rgba(201,169,78,0.5), 0 -1px 0 #fff inset"
          : "0 2px 4px rgba(0,0,0,0.15), 0 -1px 0 #fff inset",
        transform: selected ? "translateY(-8px)" : "none",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          fontSize: small ? (mobile ? 14 : 16) : (mobile ? 18 : 22),
          fontWeight: 700,
          color: getTileColor(),
          lineHeight: 1.1,
          fontFamily: "'Noto Serif', serif",
        }}
      >
        {tile.label}
      </span>
      <span
        style={{
          fontSize: small ? 7 : 9,
          color: "#888",
          marginTop: 1,
          fontFamily: "sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {getSubLabel()}
      </span>
    </div>
  );
}

// --- Meld Display ---
function MeldDisplay({ meld, small, mobile }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 1,
        margin: mobile ? "0 2px" : "0 4px",
        padding: "2px 4px",
        background: "rgba(0,0,0,0.1)",
        borderRadius: 6,
        alignItems: "flex-end",
        flexShrink: 0,
      }}
    >
      {meld.tiles.map((t, i) => (
        <Tile
          key={t.id}
          tile={t}
          small={small}
          mobile={mobile}
          faceDown={meld.concealed && i > 0 && i < meld.tiles.length - 1}
        />
      ))}
    </div>
  );
}

// --- Lobby ---
function Lobby({ onStart, onResume }) {
  const mobile = useIsMobile();
  const [playerCount, setPlayerCount] = useState(4);
  const [names, setNames] = useState(["", "", "", "", "", ""]);
  const [includeBonuses, setIncludeBonuses] = useState(false);
  const [resumeCode, setResumeCode] = useState("");
  const [resumeError, setResumeError] = useState("");

  const handleStart = () => {
    const playerNames = names
      .slice(0, playerCount)
      .map((n, i) => n.trim() || `Player ${i + 1}`);
    onStart(playerNames, includeBonuses);
  };

  const handleResume = () => {
    const state = decodeState(resumeCode.trim());
    if (state) {
      onResume(state);
    } else {
      setResumeError("Invalid state code. Please check and try again.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0d2818 0%, #1a3c2a 50%, #0d2818 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "rgba(255,255,255,0.05)",
          borderRadius: 16,
          padding: mobile ? 20 : 32,
          border: "1px solid rgba(201,169,78,0.3)",
        }}
      >
        <h1
          style={{
            color: "#c9a94e",
            fontFamily: "'Playfair Display', 'Noto Serif', serif",
            fontSize: 36,
            textAlign: "center",
            marginBottom: 4,
            letterSpacing: 2,
          }}
        >
          麻雀
        </h1>
        <p
          style={{
            color: "#8fad96",
            textAlign: "center",
            fontFamily: "'Noto Serif', serif",
            fontSize: 14,
            marginBottom: 32,
          }}
        >
          Pass & Play Mahjong
        </p>

        {/* Player count */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              color: "#c9a94e",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
              display: "block",
            }}
          >
            Players
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setPlayerCount(n)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  border: playerCount === n ? "2px solid #c9a94e" : "1px solid rgba(255,255,255,0.15)",
                  background: playerCount === n ? "rgba(201,169,78,0.15)" : "rgba(255,255,255,0.05)",
                  color: playerCount === n ? "#c9a94e" : "#8fad96",
                  fontSize: 18,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Noto Serif', serif",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Names */}
        <div style={{ marginBottom: 24 }}>
          {Array.from({ length: playerCount }, (_, i) => (
            <input
              key={i}
              value={names[i]}
              onChange={(e) => {
                const n = [...names];
                n[i] = e.target.value;
                setNames(n);
              }}
              placeholder={`Player ${i + 1}`}
              style={{
                width: "100%",
                padding: "10px 14px",
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(0,0,0,0.2)",
                color: "#f5f0e1",
                fontSize: 16,
                fontFamily: "sans-serif",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          ))}
        </div>

        {/* Bonus toggle */}
        <div
          style={{
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button
            onClick={() => setIncludeBonuses(!includeBonuses)}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              border: "none",
              background: includeBonuses ? "#c9a94e" : "rgba(255,255,255,0.15)",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                background: "#fff",
                position: "absolute",
                top: 3,
                left: includeBonuses ? 25 : 3,
                transition: "left 0.2s",
              }}
            />
          </button>
          <span style={{ color: "#8fad96", fontSize: 14 }}>
            Include Bonus Tiles (Flowers & Seasons)
          </span>
        </div>

        <button
          onClick={handleStart}
          style={{
            width: "100%",
            padding: "14px 0",
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #c9a94e 0%, #a88a30 100%)",
            color: "#1a3c2a",
            fontSize: 18,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'Noto Serif', serif",
            letterSpacing: 1,
            marginBottom: 24,
          }}
        >
          Start Game
        </button>

        {/* Resume */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 20,
          }}
        >
          <label
            style={{
              color: "#c9a94e",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
              display: "block",
            }}
          >
            Resume Game
          </label>
          <textarea
            value={resumeCode}
            onChange={(e) => {
              setResumeCode(e.target.value);
              setResumeError("");
            }}
            placeholder="Paste state code here..."
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.2)",
              color: "#f5f0e1",
              fontSize: 13,
              fontFamily: "monospace",
              minHeight: 60,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          {resumeError && (
            <p style={{ color: "#e74c3c", fontSize: 13, marginBottom: 8 }}>
              {resumeError}
            </p>
          )}
          <button
            onClick={handleResume}
            disabled={!resumeCode.trim()}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              border: "1px solid rgba(201,169,78,0.5)",
              background: "transparent",
              color: resumeCode.trim() ? "#c9a94e" : "#555",
              fontSize: 15,
              cursor: resumeCode.trim() ? "pointer" : "default",
              fontFamily: "'Noto Serif', serif",
            }}
          >
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Turn Transition Screen ---
function TurnTransition({ playerName, onReveal }) {
  return (
    <div
      onClick={onReveal}
      style={{
        position: "fixed",
        inset: 0,
        background: "linear-gradient(180deg, #0d2818 0%, #1a3c2a 50%, #0d2818 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div
        style={{
          color: "#c9a94e",
          fontFamily: "'Playfair Display', 'Noto Serif', serif",
          fontSize: 28,
          marginBottom: 16,
          textAlign: "center",
        }}
      >
        {playerName}'s Turn
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "#8fad96",
          fontSize: 16,
        }}
      >
        <Eye size={20} />
        Tap to reveal your hand
      </div>
    </div>
  );
}

// --- Claim Modal ---
function ClaimModal({ state, onClaim, onPass }) {
  const mobile = useIsMobile();
  const { lastDiscard, lastDiscardPlayer, players } = state;
  const numPlayers = players.length;
  const [claims, setClaims] = useState({});
  const [currentClaimPlayer, setCurrentClaimPlayer] = useState(null);
  const [chowSelection, setChowSelection] = useState(null);
  const [showingPlayerSelect, setShowingPlayerSelect] = useState(true);

  // Determine which players can claim what
  const claimOptions = useMemo(() => {
    const opts = {};
    for (let i = 0; i < numPlayers; i++) {
      if (i === lastDiscardPlayer) continue;
      const player = players[i];
      const hand = player.hand;
      const options = {};

      // Mahjong
      if (canWinWithTile(hand, player.melds, lastDiscard)) {
        options.mahjong = true;
      }

      // Kong
      if (canKong(hand, lastDiscard)) {
        options.kong = true;
      }

      // Pung
      if (canPung(hand, lastDiscard)) {
        options.pung = true;
      }

      // Chow
      const chowCombos = canChow(hand, lastDiscard, i, lastDiscardPlayer, numPlayers);
      if (chowCombos) {
        options.chow = true;
        options.chowCombos = getChowCombos(hand, lastDiscard);
      }

      if (Object.keys(options).length > 0) {
        opts[i] = options;
      }
    }
    return opts;
  }, [players, lastDiscard, lastDiscardPlayer, numPlayers]);

  if (currentClaimPlayer !== null) {
    const playerOpts = claimOptions[currentClaimPlayer] || {};
    const player = players[currentClaimPlayer];

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
        }}
      >
        <div
          style={{
            background: "linear-gradient(180deg, #1a3c2a 0%, #0d2818 100%)",
            borderRadius: 16,
            padding: 28,
            maxWidth: 400,
            width: "90%",
            border: "1px solid rgba(201,169,78,0.3)",
          }}
        >
          <h3
            style={{
              color: "#c9a94e",
              fontFamily: "'Noto Serif', serif",
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            {player.name}'s Claim
          </h3>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Tile tile={lastDiscard} highlighted mobile={mobile} />
          </div>

          {/* Show player's hand for chow selection */}
          {chowSelection !== null && (
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  color: "#8fad96",
                  textAlign: "center",
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                Select tiles for Chow:
              </p>
              {playerOpts.chowCombos.map((combo, ci) => (
                <button
                  key={ci}
                  onClick={() => {
                    onClaim(currentClaimPlayer, "chow", combo);
                  }}
                  style={{
                    display: "flex",
                    gap: 4,
                    margin: "8px auto",
                    padding: "8px 16px",
                    background: "rgba(201,169,78,0.15)",
                    border: "1px solid rgba(201,169,78,0.4)",
                    borderRadius: 8,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                >
                  {[...combo, lastDiscard.value]
                    .sort((a, b) => a - b)
                    .map((v, i) => (
                      <span
                        key={i}
                        style={{
                          color: "#f5f0e1",
                          fontSize: 16,
                          fontFamily: "'Noto Serif', serif",
                        }}
                      >
                        {v}
                        {SUIT_LABELS[lastDiscard.suit]}
                      </span>
                    ))}
                </button>
              ))}
              <button
                onClick={() => setChowSelection(null)}
                style={{
                  display: "block",
                  margin: "12px auto 0",
                  padding: "6px 20px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 6,
                  color: "#8fad96",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Back
              </button>
            </div>
          )}

          {chowSelection === null && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {playerOpts.mahjong && (
                <button
                  onClick={() => onClaim(currentClaimPlayer, "mahjong")}
                  style={{
                    padding: "12px",
                    borderRadius: 8,
                    border: "none",
                    background: "linear-gradient(135deg, #c0392b, #a02020)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'Noto Serif', serif",
                  }}
                >
                  🀄 Mahjong!
                </button>
              )}
              {playerOpts.kong && (
                <button
                  onClick={() => onClaim(currentClaimPlayer, "kong")}
                  style={{
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid rgba(201,169,78,0.5)",
                    background: "rgba(201,169,78,0.15)",
                    color: "#c9a94e",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Kong (4 of a kind)
                </button>
              )}
              {playerOpts.pung && (
                <button
                  onClick={() => onClaim(currentClaimPlayer, "pung")}
                  style={{
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid rgba(201,169,78,0.5)",
                    background: "rgba(201,169,78,0.15)",
                    color: "#c9a94e",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Pung (3 of a kind)
                </button>
              )}
              {playerOpts.chow && (
                <button
                  onClick={() => setChowSelection(true)}
                  style={{
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#8fad96",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Chow (sequence)
                </button>
              )}
              <button
                onClick={() => {
                  setClaims({ ...claims, [currentClaimPlayer]: "pass" });
                  setCurrentClaimPlayer(null);
                  setShowingPlayerSelect(true);
                }}
                style={{
                  padding: "12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: "#666",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Pass
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Player selection screen
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #1a3c2a 0%, #0d2818 100%)",
          borderRadius: 16,
          padding: 28,
          maxWidth: 400,
          width: "90%",
          border: "1px solid rgba(201,169,78,0.3)",
        }}
      >
        <h3
          style={{
            color: "#c9a94e",
            fontFamily: "'Noto Serif', serif",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Tile Discarded
        </h3>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <Tile tile={lastDiscard} highlighted mobile={mobile} />
        </div>
        <p
          style={{
            color: "#8fad96",
            textAlign: "center",
            fontSize: 14,
            marginBottom: 20,
          }}
        >
          Any claims? Pass device to each player to check.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {players.map((player, i) => {
            if (i === lastDiscardPlayer) return null;
            const hasClaim = claimOptions[i];
            const passed = claims[i] === "pass";
            return (
              <button
                key={i}
                onClick={() => {
                  if (!passed && hasClaim) {
                    setCurrentClaimPlayer(i);
                    setShowingPlayerSelect(false);
                  } else if (!passed && !hasClaim) {
                    setClaims({ ...claims, [i]: "pass" });
                  }
                }}
                disabled={passed}
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: passed
                    ? "1px solid rgba(255,255,255,0.05)"
                    : "1px solid rgba(201,169,78,0.3)",
                  background: passed
                    ? "rgba(255,255,255,0.02)"
                    : "rgba(255,255,255,0.05)",
                  color: passed ? "#555" : "#f5f0e1",
                  fontSize: 15,
                  cursor: passed ? "default" : "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{player.name}</span>
                <span style={{ fontSize: 12, color: passed ? "#555" : "#8fad96" }}>
                  {passed ? "Passed" : hasClaim ? "Tap to check" : "No valid claims"}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onPass}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,0.1)",
            color: "#8fad96",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          All Pass — Next Turn
        </button>
      </div>
    </div>
  );
}

// --- Score Summary ---
function ScoreSummary({ state, scoreResult, onNextRound, onNewGame }) {
  const mobile = useIsMobile();
  const winner = state.players[state.winner];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #1a3c2a 0%, #0d2818 100%)",
          borderRadius: 16,
          padding: 32,
          maxWidth: 440,
          width: "90%",
          maxHeight: "90dvh",
          overflowY: "auto",
          border: "1px solid rgba(201,169,78,0.5)",
          textAlign: "center",
        }}
      >
        <Trophy size={48} color="#c9a94e" style={{ marginBottom: 12 }} />
        <h2
          style={{
            color: "#c9a94e",
            fontFamily: "'Playfair Display', 'Noto Serif', serif",
            fontSize: 28,
            marginBottom: 8,
          }}
        >
          {winner.name} Wins!
        </h2>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 2,
              marginBottom: 12,
            }}
          >
            {winner.hand.map((t) => (
              <Tile key={t.id} tile={t} small mobile={mobile} />
            ))}
            {winner.melds.map((m, mi) => (
              <MeldDisplay key={mi} meld={m} small mobile={mobile} />
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          {scoreResult.labels.map((l, i) => (
            <div
              key={i}
              style={{
                color: "#f5f0e1",
                fontSize: 15,
                padding: "4px 0",
                fontFamily: "'Noto Serif', serif",
              }}
            >
              {l}
            </div>
          ))}
          <div
            style={{
              color: "#c9a94e",
              fontSize: 24,
              fontWeight: 700,
              marginTop: 8,
              fontFamily: "'Noto Serif', serif",
            }}
          >
            +{scoreResult.points} points
          </div>
        </div>

        {/* Scoreboard */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 16,
            marginBottom: 20,
          }}
        >
          <h4
            style={{
              color: "#8fad96",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Scores
          </h4>
          {state.players.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                color: i === state.winner ? "#c9a94e" : "#8fad96",
                fontWeight: i === state.winner ? 700 : 400,
                fontSize: 15,
              }}
            >
              <span>{p.name}</span>
              <span>{p.score}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onNextRound}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #c9a94e 0%, #a88a30 100%)",
              color: "#1a3c2a",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'Noto Serif', serif",
            }}
          >
            Next Round
          </button>
          <button
            onClick={onNewGame}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid rgba(201,169,78,0.5)",
              background: "transparent",
              color: "#c9a94e",
              fontSize: 16,
              cursor: "pointer",
              fontFamily: "'Noto Serif', serif",
            }}
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Draw Round Over ---
function DrawRoundOver({ state, onNextRound, onNewGame }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #1a3c2a 0%, #0d2818 100%)",
          borderRadius: 16,
          padding: 32,
          maxWidth: 400,
          width: "90%",
          border: "1px solid rgba(201,169,78,0.3)",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            color: "#c9a94e",
            fontFamily: "'Playfair Display', 'Noto Serif', serif",
            fontSize: 24,
            marginBottom: 12,
          }}
        >
          Draw — Wall Exhausted
        </h2>
        <p style={{ color: "#8fad96", marginBottom: 24, fontSize: 14 }}>
          No player completed a winning hand. No points awarded.
        </p>

        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 16,
            marginBottom: 20,
          }}
        >
          {state.players.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                color: "#8fad96",
                fontSize: 15,
              }}
            >
              <span>{p.name}</span>
              <span>{p.score}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onNextRound}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #c9a94e 0%, #a88a30 100%)",
              color: "#1a3c2a",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Next Round
          </button>
          <button
            onClick={onNewGame}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid rgba(201,169,78,0.5)",
              background: "transparent",
              color: "#c9a94e",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}

// --- State Code Panel ---
function StateCodePanel({ state }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => encodeState(state), [state]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "rgba(13,40,24,0.95)",
        borderTop: "1px solid rgba(201,169,78,0.2)",
        zIndex: 50,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: "none",
          border: "none",
          color: "#8fad96",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        Save / State Code
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 12px" }}>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 8,
              padding: 12,
              maxHeight: 80,
              overflow: "auto",
              marginBottom: 8,
            }}
          >
            <code
              style={{
                color: "#8fad96",
                fontSize: 10,
                wordBreak: "break-all",
                fontFamily: "monospace",
              }}
            >
              {code}
            </code>
          </div>
          <button
            onClick={handleCopy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: "0 auto",
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid rgba(201,169,78,0.4)",
              background: copied ? "rgba(46,204,113,0.15)" : "rgba(201,169,78,0.1)",
              color: copied ? "#2ecc71" : "#c9a94e",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy State Code"}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Scoreboard Overlay ---
function Scoreboard({ players, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 250,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg, #1a3c2a 0%, #0d2818 100%)",
          borderRadius: 16,
          padding: 28,
          maxWidth: 360,
          width: "90%",
          border: "1px solid rgba(201,169,78,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3
            style={{
              color: "#c9a94e",
              fontFamily: "'Noto Serif', serif",
            }}
          >
            Scoreboard
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#8fad96",
              cursor: "pointer",
            }}
          >
            <X size={20} />
          </button>
        </div>
        {players
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                color: "#f5f0e1",
                fontSize: 16,
              }}
            >
              <span>
                {i === 0 && p.score > 0 ? "👑 " : ""}
                {p.name}
              </span>
              <span style={{ color: "#c9a94e", fontWeight: 700 }}>{p.score}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN GAME COMPONENT
// ============================================================

export default function MahjongGame() {
  const mobile = useIsMobile();
  const [gameState, setGameState] = useState(null);
  const [selectedTile, setSelectedTile] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [scoreResult, setScoreResult] = useState(null);
  const [notification, setNotification] = useState(null);

  const showNotification = useCallback((msg, duration = 2000) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), duration);
  }, []);

  // Start a new game
  const handleStart = useCallback((names, includeBonuses) => {
    const state = createInitialState(names, includeBonuses);
    setGameState(state);
    setSelectedTile(null);
  }, []);

  // Resume from state code
  const handleResume = useCallback((state) => {
    setGameState(state);
    setSelectedTile(null);
  }, []);

  // Reveal hand (transition -> draw or action)
  const handleReveal = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const player = prev.players[prev.currentTurn];

      // If dealer on first turn (14 tiles), go to action phase
      if (player.hand.length === 14) {
        return { ...prev, phase: PHASES.ACTION };
      }

      // Otherwise draw
      const newState = drawTile(prev);
      return newState;
    });
    setSelectedTile(null);
  }, []);

  // Discard selected tile
  const handleDiscard = useCallback(() => {
    if (selectedTile === null) return;
    setGameState((prev) => {
      if (!prev) return prev;
      return discardTile(prev, selectedTile);
    });
    setSelectedTile(null);
  }, [selectedTile]);

  // Declare concealed kong
  const handleConcealedKong = useCallback(
    (refTile) => {
      setGameState((prev) => {
        if (!prev) return prev;
        const playerIdx = prev.currentTurn;
        const player = prev.players[playerIdx];
        const matchingTiles = player.hand.filter((t) => tilesMatch(t, refTile));
        if (matchingTiles.length < 4) return prev;

        const newHand = player.hand.filter((t) => !tilesMatch(t, refTile));
        const newMelds = [
          ...player.melds,
          { type: "kong", tiles: matchingTiles, concealed: true },
        ];
        const newPlayers = prev.players.map((p, i) =>
          i === playerIdx ? { ...p, hand: sortHand(newHand), melds: newMelds } : p
        );

        // Draw replacement from dead wall
        let newState = { ...prev, players: newPlayers };
        if (newState.deadWall.length > 0) {
          const replacement = newState.deadWall[0];
          newState = {
            ...newState,
            deadWall: newState.deadWall.slice(1),
            players: newState.players.map((p, i) =>
              i === playerIdx
                ? { ...p, hand: sortHand([...p.hand, replacement]) }
                : p
            ),
            drawnTile: replacement,
          };
        }

        return newState;
      });
      setSelectedTile(null);
    },
    []
  );

  // Add to existing pung to make kong
  const handleAddToKong = useCallback((meldIndex, tileId) => {
    setGameState((prev) => {
      if (!prev) return prev;
      const playerIdx = prev.currentTurn;
      const player = prev.players[playerIdx];
      const tile = player.hand.find((t) => t.id === tileId);
      if (!tile) return prev;

      const newMelds = player.melds.map((m, i) => {
        if (i === meldIndex) {
          return { ...m, type: "kong", tiles: [...m.tiles, tile] };
        }
        return m;
      });

      const newHand = player.hand.filter((t) => t.id !== tileId);
      const newPlayers = prev.players.map((p, i) =>
        i === playerIdx ? { ...p, hand: sortHand(newHand), melds: newMelds } : p
      );

      // Draw replacement
      let newState = { ...prev, players: newPlayers };
      if (newState.deadWall.length > 0) {
        const replacement = newState.deadWall[0];
        newState = {
          ...newState,
          deadWall: newState.deadWall.slice(1),
          players: newState.players.map((p, i) =>
            i === playerIdx
              ? { ...p, hand: sortHand([...p.hand, replacement]) }
              : p
          ),
          drawnTile: replacement,
        };
      }

      return newState;
    });
    setSelectedTile(null);
  }, []);

  // Declare win (self-drawn)
  const handleDeclareWin = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const playerIdx = prev.currentTurn;
      const player = prev.players[playerIdx];

      if (!canDeclareWin(player.hand, player.melds)) {
        // False declaration - penalize
        const newPlayers = prev.players.map((p, i) =>
          i === playerIdx
            ? { ...p, score: p.score - 1, skipNextTurn: true }
            : p
        );
        showNotification(
          `${player.name} made a false Mahjong declaration! -1 point and skip next turn.`,
          3000
        );
        return { ...prev, players: newPlayers };
      }

      const result = scoreHand(player, true, prev.prevailingWind, playerIdx);
      const newPlayers = prev.players.map((p, i) =>
        i === playerIdx ? { ...p, score: p.score + result.points } : p
      );

      setScoreResult(result);
      return {
        ...prev,
        players: newPlayers,
        phase: PHASES.GAME_OVER,
        winner: playerIdx,
        winType: "self_drawn",
      };
    });
  }, [showNotification]);

  // Handle claim from claim modal
  const handleClaim = useCallback(
    (playerIdx, claimType, chowValues) => {
      setGameState((prev) => {
        if (!prev || !prev.lastDiscard) return prev;
        const tile = prev.lastDiscard;
        const player = prev.players[playerIdx];

        if (claimType === "mahjong") {
          // Win by claiming discard
          const newHand = sortHand([...player.hand, tile]);
          const newPlayers = prev.players.map((p, i) =>
            i === playerIdx ? { ...p, hand: newHand } : p
          );
          let tempState = { ...prev, players: newPlayers };

          if (!canDeclareWin(newHand, player.melds)) {
            // False declaration
            const penalizedPlayers = prev.players.map((p, i) =>
              i === playerIdx
                ? { ...p, score: p.score - 1, skipNextTurn: true }
                : p
            );
            showNotification(
              `${player.name} made a false Mahjong declaration! -1 point.`,
              3000
            );
            return {
              ...prev,
              players: penalizedPlayers,
              phase: PHASES.CLAIM,
            };
          }

          const result = scoreHand(
            { ...player, hand: newHand },
            false,
            prev.prevailingWind,
            playerIdx
          );
          const scoredPlayers = tempState.players.map((p, i) =>
            i === playerIdx ? { ...p, score: p.score + result.points } : p
          );

          // Remove from discard pool
          const newDiscardPool = prev.discardPool.slice(0, -1);

          setScoreResult(result);
          return {
            ...tempState,
            players: scoredPlayers,
            discardPool: newDiscardPool,
            phase: PHASES.GAME_OVER,
            winner: playerIdx,
            winType: "discard",
          };
        }

        if (claimType === "kong") {
          const matching = player.hand.filter((t) => tilesMatch(t, tile));
          const meldTiles = [...matching.slice(0, 3), tile];
          const newHand = player.hand.filter(
            (t) => !matching.slice(0, 3).some((m) => m.id === t.id)
          );
          const newMelds = [
            ...player.melds,
            { type: "kong", tiles: meldTiles, concealed: false },
          ];
          const newPlayers = prev.players.map((p, i) =>
            i === playerIdx
              ? { ...p, hand: sortHand(newHand), melds: newMelds }
              : p
          );
          const newDiscardPool = prev.discardPool.slice(0, -1);

          // Draw replacement from dead wall
          let newState = {
            ...prev,
            players: newPlayers,
            discardPool: newDiscardPool,
            currentTurn: playerIdx,
            phase: PHASES.ACTION,
            lastDiscard: null,
            lastDiscardPlayer: null,
          };

          if (newState.deadWall.length > 0) {
            const replacement = newState.deadWall[0];
            newState = {
              ...newState,
              deadWall: newState.deadWall.slice(1),
              players: newState.players.map((p, i) =>
                i === playerIdx
                  ? { ...p, hand: sortHand([...p.hand, replacement]) }
                  : p
              ),
              drawnTile: replacement,
            };
          }

          return newState;
        }

        if (claimType === "pung") {
          const matching = player.hand.filter((t) => tilesMatch(t, tile));
          const meldTiles = [...matching.slice(0, 2), tile];
          const newHand = player.hand.filter(
            (t) => !matching.slice(0, 2).some((m) => m.id === t.id)
          );
          const newMelds = [
            ...player.melds,
            { type: "pung", tiles: meldTiles, concealed: false },
          ];
          const newPlayers = prev.players.map((p, i) =>
            i === playerIdx
              ? { ...p, hand: sortHand(newHand), melds: newMelds }
              : p
          );
          const newDiscardPool = prev.discardPool.slice(0, -1);

          return {
            ...prev,
            players: newPlayers,
            discardPool: newDiscardPool,
            currentTurn: playerIdx,
            phase: PHASES.ACTION,
            lastDiscard: null,
            lastDiscardPlayer: null,
            drawnTile: null,
          };
        }

        if (claimType === "chow" && chowValues) {
          const meldHandTiles = [];
          let tempHand = [...player.hand];
          for (const val of chowValues) {
            const idx = tempHand.findIndex(
              (t) => t.suit === tile.suit && t.value === val
            );
            if (idx >= 0) {
              meldHandTiles.push(tempHand[idx]);
              tempHand = [...tempHand.slice(0, idx), ...tempHand.slice(idx + 1)];
            }
          }
          const meldTiles = sortHand([...meldHandTiles, tile]);
          const newMelds = [
            ...player.melds,
            { type: "chow", tiles: meldTiles, concealed: false },
          ];
          const newPlayers = prev.players.map((p, i) =>
            i === playerIdx
              ? { ...p, hand: sortHand(tempHand), melds: newMelds }
              : p
          );
          const newDiscardPool = prev.discardPool.slice(0, -1);

          return {
            ...prev,
            players: newPlayers,
            discardPool: newDiscardPool,
            currentTurn: playerIdx,
            phase: PHASES.ACTION,
            lastDiscard: null,
            lastDiscardPlayer: null,
            drawnTile: null,
          };
        }

        return prev;
      });
    },
    [showNotification]
  );

  // All pass - advance turn
  const handleAllPass = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      return advanceTurn(prev);
    });
  }, []);

  // Next round
  const handleNextRound = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const scores = prev.players.map((p) => p.score);
      const names = prev.players.map((p) => p.name);
      const newState = createInitialState(names, prev.includeBonuses);
      // Restore scores
      newState.players = newState.players.map((p, i) => ({
        ...p,
        score: scores[i],
      }));
      // Rotate dealer
      newState.dealer = (prev.dealer + 1) % prev.players.length;
      newState.round = prev.round + 1;
      newState.currentTurn = newState.dealer;
      newState.prevailingWind =
        Math.floor(newState.round / prev.players.length) % 4;
      return newState;
    });
    setScoreResult(null);
  }, []);

  // New game
  const handleNewGame = useCallback(() => {
    setGameState(null);
    setScoreResult(null);
    setSelectedTile(null);
  }, []);

  // ---- RENDER ----

  if (!gameState) {
    return <Lobby onStart={handleStart} onResume={handleResume} />;
  }

  const state = gameState;
  const currentPlayer = state.players[state.currentTurn];

  // Turn transition
  if (state.phase === PHASES.TURN_TRANSITION) {
    return (
      <>
        <TurnTransition
          playerName={currentPlayer.name}
          onReveal={handleReveal}
        />
        <StateCodePanel state={state} />
      </>
    );
  }

  // Claim phase
  if (state.phase === PHASES.CLAIM && state.lastDiscard) {
    return (
      <>
        <ClaimModal
          state={state}
          onClaim={handleClaim}
          onPass={handleAllPass}
        />
        <StateCodePanel state={state} />
      </>
    );
  }

  // Game over (win)
  if (state.phase === PHASES.GAME_OVER && scoreResult) {
    return (
      <>
        <ScoreSummary
          state={state}
          scoreResult={scoreResult}
          onNextRound={handleNextRound}
          onNewGame={handleNewGame}
        />
        <StateCodePanel state={state} />
      </>
    );
  }

  // Round over (draw)
  if (state.phase === PHASES.ROUND_OVER) {
    return (
      <>
        <DrawRoundOver
          state={state}
          onNextRound={handleNextRound}
          onNewGame={handleNewGame}
        />
        <StateCodePanel state={state} />
      </>
    );
  }

  // Main game view (ACTION phase)
  const concealedKongs = canConcealedKong(currentPlayer.hand);
  const addableKongs = canAddToKong(currentPlayer.hand, currentPlayer.melds);
  const canWin = canDeclareWin(currentPlayer.hand, currentPlayer.melds);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background:
          "linear-gradient(180deg, #0d2818 0%, #1a3c2a 30%, #1a3c2a 70%, #0d2818 100%)",
        display: "flex",
        flexDirection: "column",
        paddingBottom: mobile ? 44 : 50,
        overflowX: "hidden",
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: mobile ? "8px 10px" : "12px 16px",
          paddingTop: mobile ? "calc(8px + env(safe-area-inset-top, 0px))" : "12px",
          background: "rgba(0,0,0,0.2)",
          borderBottom: "1px solid rgba(201,169,78,0.15)",
        }}
      >
        <div style={{ display: "flex", gap: mobile ? 8 : 16, alignItems: "center" }}>
          <span
            style={{
              color: "#c9a94e",
              fontSize: mobile ? 12 : 13,
              fontFamily: "'Noto Serif', serif",
            }}
          >
            R{state.round}
          </span>
          <span style={{ color: "#8fad96", fontSize: mobile ? 11 : 12 }}>
            {WINDS[state.prevailingWind]}
          </span>
          <span style={{ color: "#8fad96", fontSize: mobile ? 11 : 12 }}>
            {state.wall.length} left
          </span>
        </div>
        <button
          onClick={() => setShowScoreboard(true)}
          style={{
            background: "rgba(201,169,78,0.15)",
            border: "1px solid rgba(201,169,78,0.3)",
            borderRadius: 6,
            padding: mobile ? "8px 12px" : "6px 12px",
            minHeight: 44,
            color: "#c9a94e",
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Trophy size={14} />
          Scores
        </button>
      </div>

      {/* Notification */}
      {notification && (
        <div
          style={{
            position: "fixed",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(192,57,43,0.9)",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            zIndex: 400,
            fontSize: 14,
            maxWidth: "90%",
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={16} />
          {notification}
        </div>
      )}

      {/* Other players info */}
      <div
        style={{
          display: "flex",
          flexWrap: mobile ? "nowrap" : "wrap",
          gap: mobile ? 6 : 8,
          padding: mobile ? "8px 10px" : "12px 16px",
          justifyContent: mobile ? "flex-start" : "center",
          overflowX: mobile ? "auto" : "visible",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {state.players.map((player, i) => {
          if (i === state.currentTurn) return null;
          return (
            <div
              key={i}
              style={{
                background: "rgba(0,0,0,0.2)",
                borderRadius: 10,
                padding: mobile ? "6px 8px" : "8px 12px",
                minWidth: mobile ? 80 : 100,
                flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  color: "#c9a94e",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {player.name}
                {i === state.dealer && (
                  <span
                    style={{
                      marginLeft: 4,
                      fontSize: 10,
                      color: "#c0392b",
                    }}
                  >
                    莊
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 1, marginBottom: 4 }}>
                {Array.from({ length: Math.min(player.hand.length, 13) }, (_, j) => (
                  <div
                    key={j}
                    style={{
                      width: 8,
                      height: 12,
                      background: "linear-gradient(135deg, #1a5c3a, #0d3320)",
                      borderRadius: 2,
                      border: "1px solid #2d8a4e",
                    }}
                  />
                ))}
              </div>
              {player.melds.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 2,
                    marginTop: 4,
                  }}
                >
                  {player.melds.map((m, mi) => (
                    <MeldDisplay key={mi} meld={m} small mobile={mobile} />
                  ))}
                </div>
              )}
              {player.bonusTiles && player.bonusTiles.length > 0 && (
                <div style={{ display: "flex", gap: 1, marginTop: 4 }}>
                  {player.bonusTiles.map((t) => (
                    <Tile key={t.id} tile={t} small mobile={mobile} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Discard pool */}
      <div
        style={{
          flex: mobile ? "0 1 auto" : 1,
          padding: mobile ? "6px 10px" : "8px 16px",
          minHeight: mobile ? 60 : 100,
        }}
      >
        <div
          style={{
            color: "#5a7a63",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 4,
          }}
        >
          Discards ({state.discardPool.length})
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 2,
            background: "rgba(0,0,0,0.15)",
            borderRadius: 10,
            padding: mobile ? 6 : 8,
            minHeight: mobile ? 44 : 60,
            maxHeight: mobile ? 120 : "none",
            overflowY: mobile ? "auto" : "visible",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {state.discardPool.map((t, i) => (
            <Tile key={`${t.id}-${i}`} tile={t} small mobile={mobile} />
          ))}
        </div>
      </div>

      {/* Current player area */}
      <div
        style={{
          padding: mobile ? "8px 10px" : "12px 16px",
          paddingBottom: mobile ? "calc(8px + env(safe-area-inset-bottom, 0px))" : "12px",
          background: "rgba(0,0,0,0.25)",
          borderTop: "1px solid rgba(201,169,78,0.15)",
        }}
      >
        {/* Player name and actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            flexWrap: "wrap",
            gap: mobile ? 6 : 8,
          }}
        >
          <div>
            <span
              style={{
                color: "#c9a94e",
                fontFamily: "'Noto Serif', serif",
                fontSize: mobile ? 14 : 16,
                fontWeight: 600,
              }}
            >
              {currentPlayer.name}
            </span>
            {state.currentTurn === state.dealer && (
              <span
                style={{
                  marginLeft: 8,
                  color: "#c0392b",
                  fontSize: 12,
                  fontFamily: "'Noto Serif', serif",
                }}
              >
                Dealer
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {canWin && (
              <button
                onClick={handleDeclareWin}
                style={{
                  padding: mobile ? "10px 14px" : "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #c0392b, #a02020)",
                  color: "#fff",
                  fontSize: mobile ? 13 : 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  animation: "pulse 1.5s infinite",
                  minHeight: 44,
                }}
              >
                Mahjong!
              </button>
            )}
            {concealedKongs.map((refTile, i) => (
              <button
                key={i}
                onClick={() => handleConcealedKong(refTile)}
                style={{
                  padding: mobile ? "8px 10px" : "6px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(201,169,78,0.5)",
                  background: "rgba(201,169,78,0.15)",
                  color: "#c9a94e",
                  fontSize: 12,
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                Kong {refTile.label}
              </button>
            ))}
            {addableKongs.map(({ meld, tile }, i) => (
              <button
                key={`ak-${i}`}
                onClick={() => {
                  const meldIdx = currentPlayer.melds.indexOf(meld);
                  handleAddToKong(meldIdx, tile.id);
                }}
                style={{
                  padding: mobile ? "8px 10px" : "6px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(201,169,78,0.5)",
                  background: "rgba(201,169,78,0.15)",
                  color: "#c9a94e",
                  fontSize: 12,
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                +Kong {tile.label}
              </button>
            ))}
          </div>
        </div>

        {/* Melds */}
        {currentPlayer.melds.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 8,
              flexWrap: "wrap",
              overflowX: mobile ? "auto" : "visible",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {currentPlayer.melds.map((m, i) => (
              <MeldDisplay key={i} meld={m} mobile={mobile} />
            ))}
          </div>
        )}

        {/* Bonus tiles */}
        {currentPlayer.bonusTiles && currentPlayer.bonusTiles.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 2,
              marginBottom: 8,
              alignItems: "center",
            }}
          >
            <span style={{ color: "#8fad96", fontSize: 11, marginRight: 4 }}>
              Bonus:
            </span>
            {currentPlayer.bonusTiles.map((t) => (
              <Tile key={t.id} tile={t} small mobile={mobile} />
            ))}
          </div>
        )}

        {/* Hand */}
        <div
          style={{
            display: "flex",
            flexWrap: mobile ? "nowrap" : "wrap",
            gap: 2,
            alignItems: "flex-end",
            justifyContent: mobile ? "flex-start" : "center",
            overflowX: mobile ? "auto" : "visible",
            WebkitOverflowScrolling: "touch",
            paddingBottom: mobile ? 4 : 0,
            scrollbarWidth: "thin",
          }}
        >
          {currentPlayer.hand
            .filter((t) => !state.drawnTile || t.id !== state.drawnTile.id)
            .map((t) => (
              <Tile
                key={t.id}
                tile={t}
                selected={selectedTile === t.id}
                onClick={() =>
                  setSelectedTile(selectedTile === t.id ? null : t.id)
                }
                mobile={mobile}
              />
            ))}
          {state.drawnTile &&
            currentPlayer.hand.find(
              (t) => t.id === state.drawnTile.id
            ) && (
              <>
                <div
                  style={{
                    width: 2,
                    height: mobile ? 40 : 50,
                    background: "rgba(201,169,78,0.3)",
                    margin: "0 4px",
                    alignSelf: "center",
                    borderRadius: 1,
                    flexShrink: 0,
                  }}
                />
                <Tile
                  tile={state.drawnTile}
                  selected={selectedTile === state.drawnTile.id}
                  onClick={() =>
                    setSelectedTile(
                      selectedTile === state.drawnTile.id
                        ? null
                        : state.drawnTile.id
                    )
                  }
                  highlighted
                  mobile={mobile}
                />
              </>
            )}
        </div>

        {/* Discard button */}
        {selectedTile !== null && (
          <div style={{ textAlign: "center", marginTop: mobile ? 8 : 12 }}>
            <button
              onClick={handleDiscard}
              style={{
                padding: mobile ? "12px 40px" : "10px 32px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #c9a94e 0%, #a88a30 100%)",
                color: "#1a3c2a",
                fontSize: mobile ? 16 : 15,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "'Noto Serif', serif",
                minHeight: 48,
              }}
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {/* Scoreboard overlay */}
      {showScoreboard && (
        <Scoreboard
          players={state.players}
          onClose={() => setShowScoreboard(false)}
        />
      )}

      {/* State code panel */}
      <StateCodePanel state={state} />

      {/* Pulse animation & mobile styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Noto+Serif:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { height: 100vh; height: -webkit-fill-available; }
        body {
          margin: 0;
          background: #0d2818;
          -webkit-tap-highlight-color: transparent;
          overscroll-behavior: none;
          min-height: 100vh;
          min-height: -webkit-fill-available;
        }
        /* Hide scrollbars on mobile but keep scroll functional */
        @media (max-width: 600px) {
          ::-webkit-scrollbar { height: 3px; width: 3px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(201,169,78,0.3); border-radius: 2px; }
          button:active { opacity: 0.8; transform: scale(0.97); }
          input, textarea { font-size: 16px !important; }
        }
      `}</style>
    </div>
  );
}
