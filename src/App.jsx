import React, { useState, useEffect } from 'react'
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
  gapX: 18,
  levelGap: 250,
  subCols: 2,
  subRows: 2,
  subPadding: 6,
  subGap: 6,
  levels: [
    {
      rowGap: 64,
      topHallway: 0,
      bottomHallway: 0,
      middleLabel: 'Hallway / Stairs & Service',
      extraOffset: 0
    },
    {
      rowGap: 16,
      topHallway: 48,
      bottomHallway: 48,
      topLabel: 'Hallway',
      bottomLabel: 'Hallway',
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

const buildHallways = () => {
  const gridW = layoutConfig.cellCols * layoutConfig.cellW + (layoutConfig.cellCols - 1) * layoutConfig.gapX
  const hallways = []

  layoutConfig.levels.forEach((level, levelIndex) => {
    const baseY = getLevelBaseY(levelIndex)
    const row0Y = baseY + level.topHallway
    const row1Y = row0Y + layoutConfig.cellH + level.rowGap

    if (levelIndex === 0) {
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: row0Y + layoutConfig.cellH,
        w: gridW,
        h: level.rowGap,
        label: level.middleLabel
      })
    } else {
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: baseY,
        w: gridW,
        h: level.topHallway,
        label: level.topLabel
      })
      hallways.push({
        level: levelIndex,
        x: layoutConfig.startX,
        y: row1Y + layoutConfig.cellH,
        w: gridW,
        h: level.bottomHallway,
        label: level.bottomLabel
      })
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
        const cellY = baseY + levelCfg.topHallway + cr * (layoutConfig.cellH + levelCfg.rowGap)

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

  // Demo seed: each "user" owns an entire cell (4 sub-units)
  const seedCellOwner = (level, cellR, cellC, owner) => {
    const levelUnits = levels[level]?.units || []
    for (const u of levelUnits) {
      if (u.level === level && u.cellR === cellR && u.cellC === cellC) u.owner = owner
    }
  }
  seedCellOwner(0, 0, 0, 'alice')
  seedCellOwner(0, 1, 1, 'bob')
  seedCellOwner(1, 0, 2, 'charlie')

  return levels
}

const normalizeState = (data) => {
  if (data?.levels) return data
  if (Array.isArray(data?.units)) {
    const levels = layoutConfig.levels.map((_, level) => ({
      level,
      units: data.units.filter(u => u.level === level)
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

  return (
    <div className="app">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1>Floor Plan Booking (Demo)</h1>
        <div>
          {currentUser ? (
            <div>
              <span style={{marginRight:8}}>User: <strong>{currentUser}</strong></span>
              <button onClick={() => setCurrentUser('')}>Logout</button>
            </div>
          ) : (
            <UserLogin onSetUser={setCurrentUser} />
          )}
        </div>
      </div>

  <p>Each big cell is 4 small squares. You must own all 4 to start, then you can extend by +2 squares (same level or above/below).</p>
      <FloorPlan levels={state.levels} hallways={hallways} onUpdateUnit={updateUnit} currentUser={currentUser} resetApp={resetState} />
    </div>
  )
}

function UserLogin({ onSetUser }) {
  const [name, setName] = useState('')
  return (
    <span>
      <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      <button onClick={() => name && onSetUser(name)}>Set User</button>
    </span>
  )
}
