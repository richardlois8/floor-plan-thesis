// Business logic for unit reservation upgrades and downgrades.
// All functions operate on plain unit objects: { id, level, cellR, cellC, groupId, q, owner, startDate, endDate, x, y, w, h }

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

// Validate that the action date is present and not in the past.
export function validateActionDate(date) {
  if (!date) return ['Please select a date for this action.']
  const today = new Date().toISOString().split('T')[0]
  if (date < today) return ['The action date cannot be in the past.']
  return []
}

// ---------------------------------------------------------------------------
// Adjacency model
// ---------------------------------------------------------------------------

function areQuadrantsAdjacent(q1, q2) {
  // Within the 2×2 sub-unit grid:
  //   Q0 Q1
  //   Q2 Q3
  // Edge-sharing pairs: 0-1, 0-2, 1-3, 2-3  (not diagonals 0-3 or 1-2)
  const EDGE_PAIRS = new Set(['0-1','1-0','0-2','2-0','1-3','3-1','2-3','3-2'])
  return EDGE_PAIRS.has(`${q1}-${q2}`)
}

// exported so callers can enumerate adjacent pairs for the +2 extension step
export function areUnitsAdjacent(a, b) {
  // 1. Same cell — shared edge within the 2×2 grid
  if (a.level === b.level && a.groupId === b.groupId) {
    return areQuadrantsAdjacent(a.q, b.q)
  }

  // 2. Same level, same row (cellR), neighbouring columns (|Δcc|=1)
  //    Right-column quads {1,3} of the left cell touch left-column quads {0,2} of the right cell.
  if (a.level === b.level && a.cellR === b.cellR && Math.abs(a.cellC - b.cellC) === 1) {
    const left  = a.cellC < b.cellC ? a : b
    const right = a.cellC < b.cellC ? b : a
    return [1, 3].includes(left.q) && [0, 2].includes(right.q)
  }

  // 3. Same level, adjacent rows (|Δcr|=1), same column — hallway / corridor adjacency
  //    Bottom quads {2,3} of the upper cell face the hallway;
  //    top quads {0,1} of the lower cell face the hallway.
  if (a.level === b.level && Math.abs(a.cellR - b.cellR) === 1 && a.cellC === b.cellC) {
    const top = a.cellR < b.cellR ? a : b
    const bot = a.cellR < b.cellR ? b : a
    return [2, 3].includes(top.q) && [0, 1].includes(bot.q)
  }

  // 4. Different floors, same cell position — stairs connection (cross-floor allowed)
  if (a.level !== b.level && a.cellR === b.cellR && a.cellC === b.cellC) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Service-area adjacency
// ---------------------------------------------------------------------------

// The service / staircase zone sits between cellRow 0 and cellRow 1 on every level.
// Units that physically face it:
//   • cellR === 0  and  q ∈ {2, 3}  (bottom half of the upper row)
//   • cellR === 1  and  q ∈ {0, 1}  (top half of the lower row)
export function isServiceAreaAdjacent(unit) {
  return (unit.cellR === 0 && (unit.q === 2 || unit.q === 3)) ||
         (unit.cellR === 1 && (unit.q === 0 || unit.q === 1))
}

export function hasServiceAreaConnection(units) {
  return units.some(isServiceAreaAdjacent)
}

// ---------------------------------------------------------------------------
// Connectivity helpers
// ---------------------------------------------------------------------------

// Returns true when all units in the array form a single connected component.
export function areAllUnitsConnected(units) {
  if (units.length <= 1) return true

  const unitMap = new Map(units.map(u => [u.id, u]))
  const visited = new Set()
  const queue = [units[0].id]

  while (queue.length) {
    const id = queue.shift()
    if (visited.has(id)) continue
    visited.add(id)

    const cur = unitMap.get(id)
    if (!cur) continue

    for (const other of units) {
      if (!visited.has(other.id) && areUnitsAdjacent(cur, other)) {
        queue.push(other.id)
      }
    }
  }

  return visited.size === units.length
}

// Returns true when at least one target unit is directly adjacent to at least
// one unit in the existing reservation.
export function isConnectedToExistingUnits(existingUserUnits, targetUnits) {
  if (existingUserUnits.length === 0) return true // first-time reservation
  return targetUnits.some(t => existingUserUnits.some(e => areUnitsAdjacent(e, t)))
}

// ---------------------------------------------------------------------------
// Public validation API
// ---------------------------------------------------------------------------

/**
 * Validate an upgrade (adding targetUnits to the user's reservation).
 *
 * Rules enforced:
 *   1. Minimum 4 units after upgrade
 *   2. Cross-floor upgrades are always permitted (no check needed)
 *   3. Target units must be adjacent to the existing reservation
 *   4. Resulting reservation must keep ≥ 1 unit adjacent to the service area
 *
 * @param {object[]} currentUserUnits  All units currently owned by the user
 * @param {object[]} targetUnits       Units to be claimed in this upgrade
 * @returns {string[]} Array of error messages; empty means valid
 */
export function validateUpgrade(currentUserUnits, targetUnits) {
  const errors = []

  // Rule 3 — connectivity
  if (currentUserUnits.length > 0 && !isConnectedToExistingUnits(currentUserUnits, targetUnits)) {
    errors.push(
      'These units are not adjacent to your current reservation. Only connected extensions are permitted.'
    )
  }

  // Rule 4 — service-area adjacency after the change
  const unitsAfter = [...currentUserUnits, ...targetUnits]
  if (!hasServiceAreaConnection(unitsAfter)) {
    errors.push(
      'The resulting configuration has no unit adjacent to the service area. At least 1 unit must face the service zone.'
    )
  }

  return errors
}

/**
 * Validate a downgrade (releasing unitToRelease from the user's reservation).
 *
 * Rules enforced:
 *   1. Total must remain ≥ 4, or drop to 0 (full cancellation)
 *   3. Remaining units must stay fully connected
 *   4. Remaining units must keep ≥ 1 unit adjacent to the service area
 *
 * @param {object[]} currentUserUnits  All units currently owned by the user
 * @param {string}   unitToReleaseId   ID of the unit the user wants to release
 * @returns {string[]} Array of error messages; empty means valid
 */
export function validateDowngrade(currentUserUnits, unitToReleaseId) {
  const errors = []
  const remaining = currentUserUnits.filter(u => u.id !== unitToReleaseId)

  // Full cancellation is always allowed
  if (remaining.length === 0) return errors

  // Rule 2 — cannot release a unit that directly faces the service area
  const unitToRelease = currentUserUnits.find(u => u.id === unitToReleaseId)
  if (unitToRelease && isServiceAreaAdjacent(unitToRelease)) {
    errors.push(
      'Cannot release: this unit directly faces the service area and must be retained.'
    )
  }

  // Rule 1 — minimum size (2 units)
  if (remaining.length < 2) {
    errors.push(
      `Cannot release: minimum reservation is 2 units. Releasing this unit would leave you with ${remaining.length} unit(s). Release all units to cancel entirely.`
    )
  }

  // Rule 3 — connectivity of remaining units
  if (!areAllUnitsConnected(remaining)) {
    errors.push(
      'Cannot release: removing this unit would split your reservation into disconnected groups.'
    )
  }

  // Rule 4 — service-area adjacency
  if (!hasServiceAreaConnection(remaining)) {
    errors.push(
      'Cannot release: removing this unit would disconnect your reservation from the service area.'
    )
  }

  return errors
}

/**
 * Quick eligibility check used to filter the upgrade target list.
 * Returns false if the target violates rule 3 or rule 4.
 *
 * @param {object[]} currentUserUnits  All units currently owned by the user
 * @param {object[]} targetUnits       Candidate upgrade pair
 */
export function isUpgradeTargetEligible(currentUserUnits, targetUnits) {
  if (!isConnectedToExistingUnits(currentUserUnits, targetUnits)) return false
  if (!hasServiceAreaConnection([...currentUserUnits, ...targetUnits])) return false
  return true
}
