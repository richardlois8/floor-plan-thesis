import React, { useState, useEffect, useMemo } from 'react'
import FloorPlan from './components/FloorPlan'

// Minimal in-memory data model with localStorage persistence
const STORAGE_KEY = 'fp_demo_state_v1'
const USER_KEY = 'fp_demo_user_v1'

const layoutConfig = {
  cellCols: 6,
  cellRows: 2,
  cellW: 200,
  cellH: 140,
  startX: 60,
  startY: 40,
  gapX: 0,
  levelGap: 250,
  subCols: 2,
  subRows: 2,
  subPadding: 0,
  subGap: 0,
  levels: [
    {
      rowGap: 64,
      topHallway: 0,
      bottomHallway: 0,
      middleLabel: 'Hallway / Stairs & Service',
      extraOffset: 0
    },
    {
      rowGap: 64,
      topHallway: 48,
      bottomHallway: 48,
      topLabel: 'Hallway',
      bottomLabel: 'Hallway',
      middleLabel: 'Stairs & Service',
      extraOffset: 250
    }
  ]
}

const getLevelHeight = (levelIndex) => {
  const level = layoutConfig.levels[levelIndex]
  return level.topHallway + layoutConfig.cellH + level.rowGap + layoutConfig.cellH + level.bottomHallway
}

const getLevelBaseY = (levelIndex) => {
  let y = layoutConfig.startY
  for (let i = 0; i < levelIndex; i++) {
    const lvl = layoutConfig.levels[i]
    y += getLevelHeight(i) + layoutConfig.levelGap + (lvl.extraOffset || 0)
  }
  const currentOffset = layoutConfig.levels[levelIndex]?.extraOffset || 0
  return y + currentOffset
}

const buildServiceElements = (levelIndex, midY, hallH) => {
  const services = []

  const servicePairs = [
    [0, 1],
    [2, 3],
    [4, 5]
  ]

  const serviceHeight = 12
  const serviceWidth = layoutConfig.cellW * 1

  servicePairs.forEach(([leftCol, rightCol]) => {
    const leftCellX =
      layoutConfig.startX +
      leftCol * (layoutConfig.cellW + layoutConfig.gapX)

    const rightCellX =
      layoutConfig.startX +
      rightCol * (layoutConfig.cellW + layoutConfig.gapX)

    // center between 2 cells
    const centerX =
      (leftCellX + layoutConfig.cellW + rightCellX) / 2

    const x =
      centerX - serviceWidth / 2

    // attached to bottom of upper units
    const y =
      midY + 4

    services.push({
      level: levelIndex,
      type: 'service',
      x,
      y: midY - serviceHeight,
      w: serviceWidth,
      h: serviceHeight
    })

    services.push({
      level: levelIndex,
      type: 'service',
      x,
      y: midY + hallH,
      w: serviceWidth,
      h: serviceHeight
    })
  })

  return services
}

const buildHallways = () => {
  const gridW = layoutConfig.cellCols * layoutConfig.cellW + (layoutConfig.cellCols - 1) * layoutConfig.gapX
  const hallways = []

  layoutConfig.levels.forEach((level, levelIndex) => {
    const baseY = getLevelBaseY(levelIndex)
    const row0Y = baseY + level.topHallway
    const row1Y = row0Y + layoutConfig.cellH + level.rowGap
    const midY = row0Y + layoutConfig.cellH

    if (levelIndex === 0) {
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: midY,
        w: gridW,
        h: level.rowGap,
        label: level.middleLabel
      })
      hallways.push(...buildServiceElements(levelIndex, midY, level.rowGap))
    } else {
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: baseY + 32,
        w: gridW,
        h: level.topHallway,
        label: level.topLabel
      })
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: row1Y + layoutConfig.cellH - 32,
        w: gridW,
        h: level.bottomHallway,
        label: level.bottomLabel
      })
      hallways.push(...buildServiceElements(levelIndex, midY, level.rowGap))
    }
  })

  return hallways
}

const defaultUnits = () => {
  // Each big "cell" is composed of 4 sub-units (2x2). Upgrades operate on
  // groups (2 sub-units) and owning a full cell initially (4 sub-units).
  //
  // We'll model an apartment grid as `cellRows` x `cellCols` cells per level.
  // Each cell expands to 2x2 subunits.
  const levels = layoutConfig.levels.map((_, level) => ({ level, units: [] }))

  for (let level = 0; level < layoutConfig.levels.length; level++) {
    const levelCfg = layoutConfig.levels[level]
    const baseY = getLevelBaseY(level)
    for (let cr = 0; cr < layoutConfig.cellRows; cr++) {
      for (let cc = 0; cc < layoutConfig.cellCols; cc++) {
        const cellId = `L${level}-CR${cr}-CC${cc}`
        const cellX = layoutConfig.startX + cc * (layoutConfig.cellW + layoutConfig.gapX)
        let cellY = baseY + levelCfg.topHallway + cr * (layoutConfig.cellH + levelCfg.rowGap)

        if (level === 1) {
          if (cr === 0) {
            // upper row move down
            cellY += 32
          } else if (cr === 1) {
            // lower row move up
            cellY -= 32
          }
        }

        const subW = (layoutConfig.cellW - layoutConfig.subPadding * 2 - layoutConfig.subGap) / layoutConfig.subCols
        const subH = (layoutConfig.cellH - layoutConfig.subPadding * 2 - layoutConfig.subGap) / layoutConfig.subRows

        for (let sr = 0; sr < layoutConfig.subRows; sr++) {
          for (let sc = 0; sc < layoutConfig.subCols; sc++) {
            const quadrant = sr * 2 + sc // 0..3
            const id = `${cellId}-Q${quadrant}`
            const x = cellX + layoutConfig.subPadding + sc * (subW + layoutConfig.subGap)
            const y = cellY + layoutConfig.subPadding + sr * (subH + layoutConfig.subGap)
            levels[level].units.push({
              id,
              level,
              cellR: cr,
              cellC: cc,
              groupId: cellId,
              q: quadrant,
              owner: null,
              date: null,
              availableFrom: null,
              x,
              y,
              w: subW,
              h: subH
            })
          }
        }
      }
    }
  }

  // Demo seed: each "user" owns an entire cell (4 sub-units) with an open-ended period
  const seedCellOwner = (level, cellR, cellC, owner) => {
    const levelUnits = levels[level]?.units || []
    for (const u of levelUnits) {
      if (u.level === level && u.cellR === cellR && u.cellC === cellC) {
        u.owner = owner
        u.date = '2000-01-01'
      }
    }
  }
  seedCellOwner(0, 0, 0, 'alice')
  seedCellOwner(0, 1, 1, 'bob')
  seedCellOwner(1, 0, 2, 'charlie')

  return levels
}

// Ensure every unit has a date field — migrate from old startDate/endDate or bare owner format.
const migrateUnit = u => {
  const { startDate, endDate, ...rest } = u
  return {
    ...rest,
    date: u.date ?? startDate ?? (u.owner ? '2000-01-01' : null),
    availableFrom: u.availableFrom ?? null,
  }
}

const normalizeState = (data) => {
  if (data?.levels) {
    return {
      ...data,
      levels: data.levels.map(lvl => ({ ...lvl, units: lvl.units.map(migrateUnit) }))
    }
  }
  if (Array.isArray(data?.units)) {
    const levels = layoutConfig.levels.map((_, level) => ({
      level,
      units: data.units.filter(u => u.level === level).map(migrateUnit)
    }))
    return { levels }
  }
  return { levels: defaultUnits() }
}

export default function App() {
  const [state, setState] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeState(JSON.parse(raw))
    const u = defaultUnits()
    return { levels: u }
  })

  const [currentUser, setCurrentUser] = useState(() => {
    return sessionStorage.getItem(USER_KEY) || ''
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (currentUser) sessionStorage.setItem(USER_KEY, currentUser)
    else sessionStorage.removeItem(USER_KEY)
  }, [currentUser])

  const updateUnit = (id, patch) => {
    setState(s => ({
      ...s,
      levels: s.levels.map(level => ({
        ...level,
        units: level.units.map(u => (u.id === id ? { ...u, ...patch } : u))
      }))
    }))
  }

  const resetState = () => {
    localStorage.removeItem(STORAGE_KEY)
    setState({ levels: defaultUnits() })
  }

  const hallways = buildHallways()

  // Derive all current owners with unit counts from live state
  const existingUsers = useMemo(() => {
    const counts = new Map()
    state.levels.forEach(lvl => lvl.units.forEach(u => {
      if (u.owner) counts.set(u.owner, (counts.get(u.owner) || 0) + 1)
    }))
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state])

  const currentUserUnitCount = existingUsers.find(u => u.name === currentUser)?.count ?? 0

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title-row">
          <h1 className="app-title">Floor Plan Booking</h1>
          {currentUser && (
            <UserBadge
              name={currentUser}
              unitCount={currentUserUnitCount}
              onLogout={() => setCurrentUser('')}
            />
          )}
        </div>
        {!currentUser && (
          <UserSelector existingUsers={existingUsers} onSetUser={setCurrentUser} />
        )}
      </div>
      <FloorPlan levels={state.levels} hallways={hallways} onUpdateUnit={updateUnit} currentUser={currentUser} resetApp={resetState} />
    </div>
  )
}

// ── Deterministic avatar colour based on name ──────────────────────────────
const AVATAR_COLORS = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777']
const avatarColor = name => AVATAR_COLORS[(name.charCodeAt(0) + name.length) % AVATAR_COLORS.length]

// ── Compact badge shown in the header when a user is logged in ─────────────
function UserBadge({ name, unitCount, onLogout }) {
  return (
    <div className="user-badge">
      <span className="user-avatar" style={{ background: avatarColor(name) }}>
        {name[0].toUpperCase()}
      </span>
      <div className="user-badge-info">
        <span className="user-badge-name">{name}</span>
        <span className="user-badge-meta">{unitCount} unit{unitCount !== 1 ? 's' : ''} reserved</span>
      </div>
      <button className="user-logout-btn" onClick={onLogout}>Logout</button>
    </div>
  )
}

// ── Full selector shown below the header when no user is logged in ─────────
function UserSelector({ existingUsers, onSetUser }) {
  const [newName, setNewName] = useState('')

  const handleJoin = () => {
    const name = newName.trim()
    if (name) { onSetUser(name); setNewName('') }
  }

  return (
    <div className="user-selector">
      {existingUsers.length > 0 && (
        <div className="user-selector-section">
          <span className="user-selector-label">Login as existing user</span>
          <div className="user-card-list">
            {existingUsers.map(u => (
              <button key={u.name} className="user-card" onClick={() => onSetUser(u.name)}>
                <span className="user-avatar user-avatar--sm" style={{ background: avatarColor(u.name) }}>
                  {u.name[0].toUpperCase()}
                </span>
                <span className="user-card-name">{u.name}</span>
                <span className="user-card-count">{u.count} unit{u.count !== 1 ? 's' : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="user-selector-divider">or join as new user</div>
      <div className="user-new-form">
        <input
          className="user-new-input"
          placeholder="Enter your name..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          autoFocus
        />
        <button onClick={handleJoin} disabled={!newName.trim()}>Join</button>
      </div>
    </div>
  )
}
