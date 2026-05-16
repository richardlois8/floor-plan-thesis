import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SVG } from '@svgdotjs/svg.js'
import {
  validateUpgrade,
  validateDowngrade,
  isUpgradeTargetEligible,
  areUnitsAdjacent,
  validateActionDate,
} from '../utils/reservationRules'

export default function FloorPlan({ levels, hallways, onUpdateUnit, currentUser, resetApp }) {
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [selectedTargetKey, setSelectedTargetKey] = useState(null)
  const [selectedOwnUnitId, setSelectedOwnUnitId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [notification, setNotification] = useState(null)

  const showAlert = (title, body) =>
    setNotification({ title, lines: Array.isArray(body) ? body : [body] })

  // Single action date — written into every reserve / release action.
  const todayISO = new Date().toISOString().split('T')[0]
  const [actionDate, setActionDate] = useState(todayISO)

  const levelHostRefs = useRef(new Map())
  const drawRefs = useRef([])
  const unitElsRef = useRef(new Map()) // id -> { rect, label }
  const targetElsRef = useRef(new Map()) // key -> svg.js element
  const cellElsRef = useRef(new Map()) // groupId -> svg.js element

  const flatUnits = useMemo(() => levels.flatMap(level => level.units), [levels])
  const unitsById = useMemo(() => new Map(flatUnits.map(u => [u.id, u])), [flatUnits])
  const levelUnitsMap = useMemo(() => new Map(levels.map(level => [level.level, level.units])), [levels])
  const planStats = useMemo(() => {
    const occupied = flatUnits.filter(u => u.owner).length
    const ownedByCurrentUser = currentUser
      ? flatUnits.filter(u => u.owner === currentUser).length
      : 0

    return {
      total: flatUnits.length,
      available: flatUnits.length - occupied,
      occupied,
      ownedByCurrentUser,
    }
  }, [flatUnits, currentUser])

  // Units the current user currently owns
  const currentUserAllUnits = useMemo(
    () => flatUnits.filter(u => u.owner === currentUser),
    [flatUnits, currentUser]
  )

  // Rows that already have at least one tenant (or a recently released unit) — keyed as "level-cellR"
  const registeredRows = useMemo(() => {
    const s = new Set()
    for (const u of flatUnits) if (u.owner || u.availableFrom) s.add(`${u.level}-${u.cellR}`)
    return s
  }, [flatUnits])

  const selectUnit = u => {
    setSelectedGroupId(u.groupId || null)
    setSelectedTargetKey(null)
    setSelectedOwnUnitId(null)
  }

  const groupUnits = useMemo(() => {
    const m = new Map()
    for (const u of flatUnits) {
      const key = u.groupId
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(u)
    }
    return m
  }, [flatUnits])

  const getGroupOwner = (groupId) => {
    const g = groupUnits.get(groupId) || []
    // group is owned only if *all 4* subunits have the same owner
    const owners = new Set(g.map(x => x.owner).filter(Boolean))
    if (owners.size !== 1) return null
    const owner = [...owners][0]
    if (g.every(x => x.owner === owner)) return owner
    return null
  }

  const isFullCellOwnedByUser = (groupId) => getGroupOwner(groupId) === currentUser

  const eligibleTargets = useMemo(() => {
    if (!currentUser) return []

    // ── PHASE 1: INITIAL RESERVATION (user has no units yet) ─────────────────
    // Rules:
    //  • Only allow starting in a row that already has at least one tenant.
    //  • The full 4-unit cell must be available (no partial reservations).
    if (currentUserAllUnits.length === 0) {
      if (!selectedGroupId) return []
      const g = groupUnits.get(selectedGroupId) || []
      if (!g.length) return []

      const cellLevel = g[0].level
      const cellRow   = g[0].cellR // 0 = top-row cells, 1 = bottom-row cells

      // Row must have at least one existing tenant before new users can register there
      const rowIsRegistered = flatUnits.some(
        u => u.owner && u.level === cellLevel && u.cellR === cellRow
      )
      if (!rowIsRegistered) return []

      // First reservation is the full 4-unit cell (all sub-units must be available on actionDate)
      if (g.length === 4 && g.every(u => !u.owner && (!u.availableFrom || actionDate >= u.availableFrom))) {
        return [{
          key: `INIT:${selectedGroupId}:full`,
          kind: 'initial-cell',
          label: selectedGroupId,
          unitIds: g.map(u => u.id),
          distance: 0,
        }]
      }
      return []
    }

    // ── PHASE 2: EXTENSION ───────────────────────────────────────────────────
    // Add 1 empty adjacent unit at a time (registered rows only).
    const userLevels = new Set(currentUserAllUnits.map(u => u.level))
    const userCx = currentUserAllUnits.reduce((s, u) => s + u.x + u.w / 2, 0) / currentUserAllUnits.length
    const userCy = currentUserAllUnits.reduce((s, u) => s + u.y + u.h / 2, 0) / currentUserAllUnits.length

    const targets = []
    for (const u of flatUnits) {
      if (u.owner) continue
      if (u.availableFrom && actionDate < u.availableFrom) continue
      if (!registeredRows.has(`${u.level}-${u.cellR}`)) continue
      if (!isUpgradeTargetEligible(currentUserAllUnits, [u])) continue
      const cx = u.x + u.w / 2
      const cy = u.y + u.h / 2
      targets.push({
        key: `U:${u.id}`,
        kind: userLevels.has(u.level) ? 'same-level' : 'cross-floor',
        label: u.id,
        unitIds: [u.id],
        distance: Math.round(Math.hypot(cx - userCx, cy - userCy))
      })
    }

    return targets.sort((a, b) => a.distance - b.distance)
  }, [currentUser, currentUserAllUnits, selectedGroupId, flatUnits, groupUnits, registeredRows, actionDate])

  const submitAction = () => {
    if (!currentUser) return showAlert('Login required', 'Please log in before making a reservation.')
    const dateErrors = validateActionDate(actionDate)
    if (dateErrors.length) return showAlert('Invalid date', dateErrors)

    if (currentUserAllUnits.length === 0) {
      // Phase 1: initial full-cell reservation (4 units)
      if (!selectedGroupId) return showAlert('No cell selected', 'Click any cell on the floor plan to select your starting location.')
      if (!eligibleTargets.length) return showAlert('Cell unavailable', 'This cell is not available. Pick another one.')
      const cellTarget = eligibleTargets.find(t => t.key === selectedTargetKey && t.kind === 'initial-cell')
        || eligibleTargets.find(t => t.kind === 'initial-cell')
      if (!cellTarget) return showAlert('Cell unavailable', 'This cell is not available. Pick another one.')
      setSelectedTargetKey(cellTarget.key)
      setConfirm({ isInitial: true, target: cellTarget })
    } else {
      // Phase 2: add 1 unit at a time
      if (!eligibleTargets.length) return showAlert('No units available', 'No adjacent empty units are available to add.')
      const target = eligibleTargets.find(t => t.key === selectedTargetKey) || eligibleTargets[0]
      const targetUnits = target.unitIds.map(id => unitsById.get(id)).filter(Boolean)
      const errors = validateUpgrade(currentUserAllUnits, targetUnits)
      if (errors.length) return showAlert('Cannot add unit', errors)
      setSelectedTargetKey(target.key)
      setConfirm({ isInitial: false, target })
    }
  }

  const submitRelease = () => {
    if (!selectedOwnUnitId) return
    const errors = validateDowngrade(currentUserAllUnits, selectedOwnUnitId)
    if (errors.length) return showAlert('Release not allowed', errors)
    setConfirm({ isRelease: true, unitId: selectedOwnUnitId, label: selectedOwnUnitId })
  }

  const toggleClaim = u => {
    if (!currentUser) return showAlert('Login required', 'Please log in before claiming a unit.')
    if (!u.owner) {
      // Debug claim: enforce registered-row check, date availability, and connectivity rules.
      if (!registeredRows.has(`${u.level}-${u.cellR}`)) {
        return showAlert('Cannot claim', 'This row has no existing reservations.')
      }
      if (u.availableFrom && actionDate < u.availableFrom) {
        return showAlert('Cannot claim', `This unit is not available until ${u.availableFrom}.`)
      }
      if (currentUserAllUnits.length > 0) {
        const errors = validateUpgrade(currentUserAllUnits, [u])
        if (errors.length) return showAlert('Cannot claim', errors)
      }
      onUpdateUnit(u.id, { owner: currentUser, date: actionDate, availableFrom: null })
    } else if (u.owner === currentUser) {
      // Releasing (downgrade): validate all rules before allowing the release
      const errors = validateDowngrade(currentUserAllUnits, u.id)
      if (errors.length) return showAlert('Release not allowed', errors)
      onUpdateUnit(u.id, { owner: null, date: null, availableFrom: actionDate })
    } else {
      showAlert('Unit occupied', `This unit is reserved by ${u.owner}.`)
    }
  }

  // Calculate viewBox size based on units extents
  const levelViewBoxes = useMemo(() => {
    const map = new Map()
    levels.forEach(level => {
      const padding = level.level === 0 ? 120 : 80
      const units = level.units
      const levelHalls = (hallways || []).filter(h => h.level === level.level)
      if (!units.length && !levelHalls.length) return

      const xs = []
      const ys = []
      units.forEach(u => {
        xs.push(u.x, u.x + u.w)
        ys.push(u.y, u.y + u.h)
      })
      levelHalls.forEach(h => {
        xs.push(h.x, h.x + h.w)
        ys.push(h.y, h.y + h.h)
      })

      const minX = Math.max(0, Math.min(...xs) - padding)
      const minY = Math.max(0,Math.min(...ys) - padding)
      const maxX = Math.max(...xs) + padding
      const maxY = Math.max(...ys) + padding
      map.set(level.level, `${minX} ${minY} ${maxX - minX} ${maxY - minY}`)
    })
    return map
  }, [levels, hallways])

  // (Re)draw using svg.js
  useEffect(() => {
    const drawLevel = (levelIndex, hostEl) => {
      const viewBox = levelViewBoxes.get(levelIndex)
      if (!viewBox) return

      hostEl.innerHTML = ''
      const levelUnits = levelUnitsMap.get(levelIndex) || []
      const draw = SVG().addTo(hostEl).viewbox(viewBox).addClass('floorplan-svg-impl')
      drawRefs.current.push(draw)

      // level header band — drawn first so hallways render on top of it
      if (levelUnits.length) {
        const xs = levelUnits.map(u => [u.x, u.x + u.w]).flat()
        const ys = levelUnits.map(u => [u.y, u.y + u.h]).flat()
        // include hallways so minY reaches the top hallway on levels that have one
        ;(hallways || []).filter(h => h.level === levelIndex).forEach(h => {
          xs.push(h.x, h.x + h.w)
          ys.push(h.y, h.y + h.h)
        })
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        const padX = 30
        const padY = 50
        const topSpacing = levelIndex === 0 ? 28 : 0
        const bandY = minY - 44
        const bandW = (maxX - minX) + padX * 2
        const bandH = (maxY - minY) + padY * 2
        const bandX = minX - padX
        const labelText = levelIndex === 0 ? 'Level 1 (Ground Floor)' : 'Level 2'

        draw
          .rect(bandW, bandH)
          .move(bandX, minY - padY)
          .radius(20)
          .fill(levelIndex === 0 ? 'rgba(239, 246, 255, 0.92)' : 'rgba(236, 253, 245, 0.88)')
          .stroke({ color: levelIndex === 0 ? 'rgba(37, 99, 235, 0.20)' : 'rgba(5, 150, 105, 0.22)', width: 1.5 })

        draw
          .rect(bandW, 30)
          .move(bandX, bandY)
          .radius(10)
          .fill(levelIndex === 0 ? 'rgba(37, 99, 235, 0.18)' : 'rgba(5, 150, 105, 0.18)')
          .stroke({ color: levelIndex === 0 ? 'rgba(37, 99, 235, 0.38)' : 'rgba(5, 150, 105, 0.38)', width: 1 })

        draw
          .text(labelText)
          .move(bandX + 14, bandY + 6)
          .font({ size: 14, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
          .fill('#102033')
      }

      // hallway/service zones (drawn after band so they appear on top of it)
      if (hallways?.length) {
        const levelHalls = hallways.filter(h => h.level === levelIndex)

        // Draw hallway backgrounds first, then service elements on top
        const backgrounds = levelHalls.filter(h => !h.type)
        const elements = levelHalls.filter(h => h.type === 'service')

        backgrounds.forEach(h => {
          const zone = draw
            .rect(h.w, h.h)
            .move(h.x, h.y)
            // .radius(14)
            .fill('rgba(226, 232, 240, 0.86)')
            .stroke({ color: 'rgba(148, 163, 184, 0.55)', width: 2, dasharray: [8, 6] })
          zone.addClass('hallway-rect')
          if (h.label) {
            draw
              .text(h.label)
              .move(h.x + 12, h.y + 10)
              .font({ size: 13, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
              .fill('#475569')
          }
        })

        elements.forEach(h => {
          draw
            .rect(h.w, h.h)
            .move(h.x, h.y)
            .radius(2)
            .fill('#14b8a6')
            .stroke({ color: '#0f766e', width: 2 })
        })
      }

      // cell boundaries (show users the 4-unit cell grouping)
      for (const [gid, g] of groupUnits.entries()) {
        if (!g.length || g[0].level !== levelIndex) continue
        const minX = Math.min(...g.map(i => i.x))
        const minY = Math.min(...g.map(i => i.y))
        const maxX = Math.max(...g.map(i => i.x + i.w))
        const maxY = Math.max(...g.map(i => i.y + i.h))
        const pad = 0
        const isSelected = gid === selectedGroupId

        const boundary = draw
          .rect((maxX - minX) + pad * 2, (maxY - minY) + pad * 2)
          .move(minX - pad, minY - pad)
          // .radius(14)
          .fill('transparent')
          .stroke({
            color: isSelected ? '#f97316' : 'rgba(100,116,139,0.22)',
            width: isSelected ? 3 : 1.25,
            dasharray: []
          })

        cellElsRef.current.set(gid, boundary)
      }

      // units
      levelUnits.forEach(u => {
        const occupied = !!u.owner
        const ownedByMe = u.owner === currentUser
        const pendingAvailable = !occupied && !!u.availableFrom && actionDate < u.availableFrom
        const fillColor = occupied
          ? (ownedByMe ? '#2563eb' : '#334155')
          : pendingAvailable
            ? 'rgba(253, 186, 116, 0.72)'
            : 'rgba(255, 255, 255, 0.72)'
        const strokeColor = occupied
          ? 'rgba(15, 23, 42, 0.32)'
          : pendingAvailable
            ? 'rgba(234, 88, 12, 0.45)'
            : 'rgba(148, 163, 184, 0.45)'
        const rect = draw
          .rect(u.w, u.h)
          .move(u.x, u.y)
          .radius(0)
          .fill(fillColor)
          .stroke({ color: strokeColor, width: 1 })

        // Tooltip: show who reserved it and when, or when it becomes available
        if (occupied) {
          rect.element('title').words(`${u.owner} - reserved ${u.date ?? '-'}`)
        } else if (pendingAvailable) {
          rect.element('title').words(`Available from ${u.availableFrom}`)
        }

        rect.attr({ 'data-id': u.id })
        rect.css({ cursor: (occupied && !ownedByMe) || pendingAvailable ? 'not-allowed' : 'pointer' })

        // const label = draw
        //   .text(u.id)
        //   .move(u.x + 10, u.y + 10)
        //   .font({ size: 14, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
        //   .fill(occupied ? '#fff' : '#222')
        const label = null

        // hover animations
        // rect.on('mouseenter', () => {
        //   rect.stroke({ width: 3, color: occupied ? '#111' : '#ff8a00' })
        // })
        // rect.on('mouseleave', () => {
        //   const isInSelCell = selectedGroupId && u.groupId === selectedGroupId
        //   rect.stroke({ width: isInSelCell ? 2 : 1, color: occupied ? '#000' : '#000000' })
        // })

        // click handlers
        rect.on('click', () => {
          // Units reserved by other users are fully non-interactive
          if (u.owner && u.owner !== currentUser) return

          if (currentUserAllUnits.length === 0) {
            // Phase 1: toggle group selection — click again to deselect
            if (u.groupId === selectedGroupId) {
              setSelectedGroupId(null)
              setSelectedTargetKey(null)
            } else {
              selectUnit(u)
            }
          } else if (!u.owner) {
            // Phase 2: toggle the single-unit eligible target
            const key = `U:${u.id}`
            if (eligibleTargets.some(t => t.key === key)) {
              setSelectedTargetKey(prev => prev === key ? null : key)
            }
            setSelectedGroupId(u.groupId || null)
            setSelectedOwnUnitId(null)
          } else {
            // Own unit → toggle release selection; click again to deselect
            if (u.id === selectedOwnUnitId) {
              setSelectedOwnUnitId(null)
              setSelectedGroupId(null)
            } else {
              setSelectedOwnUnitId(u.id)
              setSelectedGroupId(u.groupId || null)
              setSelectedTargetKey(null)
            }
          }
        })
        rect.on('dblclick', e => {
          e.preventDefault()
          if (u.owner && u.owner !== currentUser) return
          toggleClaim(u)
        })

        unitElsRef.current.set(u.id, { rect, label })
      })

      // draw target highlights — clipped to the target's own cell row so the box
      // never bleeds into the hallway / service zone on either floor.
      if (eligibleTargets.length) {
        eligibleTargets.forEach(t => {
          const items = t.unitIds.map(id => unitsById.get(id)).filter(Boolean)
          if (!items.length) return
          if (items[0].level !== levelIndex) return

          const pad = 3
          let hlX  = Math.min(...items.map(i => i.x)) - pad
          let hlY  = Math.min(...items.map(i => i.y)) - pad
          let hlX2 = Math.max(...items.map(i => i.x + i.w)) + pad
          let hlY2 = Math.max(...items.map(i => i.y + i.h)) + pad

          // Clip Y to the actual cell-row bounds (derived from unit positions).
          // This is level-structure-agnostic — works the same for Level 0 and Level 1.
          const rowCellR = items[0].cellR
          const rowUnits = (levelUnitsMap.get(levelIndex) || []).filter(u => u.cellR === rowCellR)
          if (rowUnits.length) {
            const rowMinY = Math.min(...rowUnits.map(u => u.y))
            const rowMaxY = Math.max(...rowUnits.map(u => u.y + u.h))
            hlY  = Math.max(hlY,  rowMinY)
            hlY2 = Math.min(hlY2, rowMaxY)
          }

          if (hlY2 <= hlY) return // clipped to nothing — skip

          const hl = draw
            .rect(hlX2 - hlX, hlY2 - hlY)
            .move(hlX, hlY)
            .fill('rgba(245,158,11,0.14)')
            .stroke({ color: '#f59e0b', width: 2, dasharray: [5, 4] })

          hl.css({ cursor: 'pointer' })
          hl.on('mouseenter', () => hl.stroke({ width: 4 }))
          hl.on('mouseleave', () => hl.stroke({ width: selectedTargetKey === t.key ? 5 : 2 }))
          hl.on('click', () => {
            setSelectedTargetKey(prev => prev === t.key ? null : t.key)
          })

          targetElsRef.current.set(t.key, hl)
        })
      }

      // initial selected cell styling: highlight all 4 subunits if owned
      if (selectedGroupId) {
        const g = groupUnits.get(selectedGroupId) || []
        if (g.length && g[0].level === levelIndex) {
          g.forEach(x => {
            const el = unitElsRef.current.get(x.id)
            if (el) el.rect.stroke({ width: 4, color: '#ff8a00' })
          })
        }
      }
    }

    unitElsRef.current = new Map()
    targetElsRef.current = new Map()
    cellElsRef.current = new Map()
    drawRefs.current = []

    levels.forEach(level => {
      const hostEl = levelHostRefs.current.get(level.level)
      if (hostEl) drawLevel(level.level, hostEl)
    })

    return () => {
      drawRefs.current.forEach(d => {
        try { d.clear() } catch { /* ignore */ }
      })
      drawRefs.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, flatUnits, levelViewBoxes, eligibleTargets, selectedTargetKey, selectedGroupId, groupUnits, unitsById, hallways, levelUnitsMap])

  // Animate selection changes (cell selection + target selection + release selection)
  useEffect(() => {
    const map = unitElsRef.current
    const selectedUnits = new Set((groupUnits.get(selectedGroupId) || []).map(u => u.id))

    for (const [id, obj] of map.entries()) {
      const u = unitsById.get(id)
      const occupied = !!u?.owner
      const isInSelCell = selectedUnits.has(id)
      const isSelectedForRelease = id === selectedOwnUnitId

      let strokeColor = occupied ? 'rgba(15, 23, 42, 0.32)' : 'rgba(148, 163, 184, 0.45)'
      let strokeWidth = 1
      if (isSelectedForRelease) {
        strokeColor = '#dc2626'
        strokeWidth = 4
      } else if (isInSelCell) {
        strokeColor = '#f97316'
        strokeWidth = 4
      }
      obj.rect.stroke({ width: strokeWidth, color: strokeColor })
    }

    // highlight chosen target
    for (const [key, hl] of targetElsRef.current.entries()) {
      const isSelTarget = key === selectedTargetKey
      hl.stroke({ width: isSelTarget ? 5 : 2, color: isSelTarget ? '#0ea5e9' : '#f59e0b' })
      hl.fill(isSelTarget ? 'rgba(14,165,233,0.20)' : 'rgba(245,158,11,0.14)')
    }

    // highlight selected cell boundary
    for (const [gid, boundary] of cellElsRef.current.entries()) {
      const isSelected = gid === selectedGroupId
      boundary.stroke({
        color: isSelected ? '#f97316' : 'rgba(100,116,139,0.22)',
        width: isSelected ? 3 : 1
      })
    }
  }, [selectedGroupId, selectedTargetKey, selectedOwnUnitId, groupUnits, unitsById])

  return (
    <div className="floorplan-wrap">
      <section className="plan-overview" aria-label="Floor plan summary">
        <div className="overview-card">
          <span className="overview-label">Total units</span>
          <strong>{planStats.total}</strong>
        </div>
        <div className="overview-card">
          <span className="overview-label">Available</span>
          <strong>{planStats.available}</strong>
        </div>
        <div className="overview-card">
          <span className="overview-label">Occupied</span>
          <strong>{planStats.occupied}</strong>
        </div>
        <div className="overview-card overview-card--accent">
          <span className="overview-label">Your units</span>
          <strong>{planStats.ownedByCurrentUser}</strong>
        </div>
      </section>

      <div className="layout">
        <div className="floorplan-levels">
          {levels.map(level => (
            <div key={level.level} className="floorplan-level">
              <div
                ref={el => {
                  if (el) levelHostRefs.current.set(level.level, el)
                }}
                className="floorplan-svg"
              />
            </div>
          ))}
        </div>

        <aside className="sidepanel">
          <div className="panel-kicker">Reservation controls</div>
          {/* ── Action date ───────────────────────────────────────── */}
          <div className="sidepanel-title">Action date</div>
          <div className="date-picker-row">
            <label className="date-field">
              <span>Date</span>
              <input type="date" value={actionDate} min={todayISO}
                onChange={e => setActionDate(e.target.value)} />
            </label>
          </div>

          {/* ── Action section ────────────────────────────────────── */}
          <div className="sidepanel-title" style={{marginTop: 14}}>
            {currentUserAllUnits.length === 0
              ? 'New reservation'
              : 'Add a unit'}
          </div>

          {!currentUser && (
            <div className="sidepanel-hint">Set your user name to make a reservation.</div>
          )}
          {currentUser && currentUserAllUnits.length === 0 && !selectedGroupId && (
            <div className="sidepanel-hint">Click any cell to select your starting location.</div>
          )}
          {currentUser && currentUserAllUnits.length === 0 && selectedGroupId && eligibleTargets.length === 0 && (() => {
            const g = groupUnits.get(selectedGroupId) || []
            const cellLevel = g[0]?.level
            const cellRow   = g[0]?.cellR
            const rowRegistered = flatUnits.some(u => u.owner && u.level === cellLevel && u.cellR === cellRow)
            return rowRegistered
              ? <div className="sidepanel-hint">This cell is already partially or fully occupied. Pick another cell in the same row.</div>
              : <div className="sidepanel-hint">This row has no existing reservations yet. New registrations are not permitted here. Choose a cell in a registered row.</div>
          })()}
          {currentUser && currentUserAllUnits.length === 0 && selectedGroupId && eligibleTargets.length > 0 && (
            <div className="sidepanel-hint">Click <strong>Reserve Cell</strong> to reserve all 4 units in this cell.</div>
          )}
          {currentUser && currentUserAllUnits.length > 0 && eligibleTargets.length === 0 && (
            <div className="sidepanel-hint">No adjacent empty units available.</div>
          )}
          {currentUser && currentUserAllUnits.length > 0 && eligibleTargets.length > 0 && (
            <div className="sidepanel-hint">Click an adjacent empty unit to add it to your reservation.</div>
          )}

          {eligibleTargets.length > 0 && (
            <div className="target-list">
              {eligibleTargets.map(t => (
                <button
                  key={t.key}
                  className={`target-item ${t.key === selectedTargetKey ? 'active' : ''}`}
                  onClick={() => setSelectedTargetKey(t.key)}
                >
                  <div className="target-main">
                    <div className="target-label">{t.label}</div>
                    <div className="target-meta">
                      {t.unitIds.length > 1 && (
                        <span className="pill">
                          {t.pairRow ? `2 units / ${t.pairRow}` : '2 units'}
                        </span>
                      )}
                      <span className="pill">
                        {t.kind === 'cross-floor' ? 'cross-floor' : 'same level'}
                      </span>
                      <span className="pill">dist {t.distance}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Release section — shown when user has clicked one of their own units */}
          {currentUser && selectedOwnUnitId && currentUserAllUnits.some(u => u.id === selectedOwnUnitId) && (
            <div className="release-section">
              <div className="sidepanel-title" style={{color:'#c0392b', marginTop: 12}}>Release unit</div>
              <div className="sidepanel-hint">
                Selected: <strong>{selectedOwnUnitId}</strong>
              </div>
              {(() => {
                const errors = validateDowngrade(currentUserAllUnits, selectedOwnUnitId)
                return errors.length > 0
                  ? errors.map((e, i) => (
                      <div key={i} className="sidepanel-hint sidepanel-hint--danger">{e}</div>
                    ))
                  : <button className="release-btn" onClick={submitRelease}>Release This Unit</button>
              })()}
            </div>
          )}
        </aside>
      </div>

      <div className="controls">
        <button
          onClick={submitAction}
          disabled={!currentUser || (currentUserAllUnits.length === 0 ? !selectedGroupId : !eligibleTargets.length)}
        >
          {currentUserAllUnits.length === 0
            ? 'Reserve Cell'
            : 'Add Unit'}
        </button>
        <button
          onClick={submitRelease}
          disabled={!selectedOwnUnitId || !currentUserAllUnits.some(u => u.id === selectedOwnUnitId)}
          className={selectedOwnUnitId && currentUserAllUnits.some(u => u.id === selectedOwnUnitId) ? 'danger-btn' : ''}
        >
          Release Unit
        </button>
        <button onClick={() => { resetApp() }}>Reset</button>
      </div>

      <div className="legend">
        <div><span className="box filled"/> Occupied</div>
        <div><span className="box"/> Available</div>
        <div><span className="box pending"/> Releasing soon</div>
        <div><span className="box selected"/> Selected</div>
        <div style={{marginLeft:12}}>
          {currentUserAllUnits.length === 0
            ? 'Tip: click any cell, then click "Reserve Cell" to reserve all 4 units.'
            : 'Tip: click an adjacent empty unit (any registered row) to add it. Click your own unit then "Release Unit" to remove it.'}
        </div>
      </div>

      {confirm && (
        <div className="modal-overlay">
          <div className="modal">
            {(() => {
              const addCount = confirm.target?.unitIds?.length ?? 1
              return (<>
                <h3>
                  {confirm.isRelease ? 'Confirm release'
                    : confirm.isInitial ? 'Confirm reservation'
                    : `Confirm add ${addCount > 1 ? addCount + ' units' : 'unit'}`}
                </h3>
                <p>
                  {confirm.isRelease
                    ? <>Release unit <strong>{confirm.label}</strong> on <strong>{actionDate}</strong>?</>
                    : confirm.isInitial
                      ? <>Reserve <strong>{confirm.target.label}</strong> ({confirm.target.unitIds.length} units) on <strong>{actionDate}</strong>?</>
                      : <>Add <strong>{confirm.target.label}</strong>{addCount > 1 ? ` (${addCount} units)` : ''} on <strong>{actionDate}</strong>?</>
                  }
                </p>
              </>)
            })()}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button className="primary-btn" onClick={() => {
                if (confirm.isRelease) {
                  const errors = validateDowngrade(currentUserAllUnits, confirm.unitId)
                  if (errors.length) {
                    setConfirm(null)
                    return showAlert('No longer valid', errors)
                  }
                  onUpdateUnit(confirm.unitId, { owner: null, date: null, availableFrom: actionDate })
                  setSelectedOwnUnitId(null)
                } else if (confirm.isInitial) {
                  confirm.target.unitIds.forEach(id => onUpdateUnit(id, { owner: currentUser, date: actionDate, availableFrom: null }))
                } else {
                  const targetUnits = confirm.target.unitIds.map(id => unitsById.get(id)).filter(Boolean)
                  const errors = validateUpgrade(currentUserAllUnits, targetUnits)
                  if (errors.length) {
                    setConfirm(null)
                    return showAlert('No longer valid', errors)
                  }
                  confirm.target.unitIds.forEach(id => onUpdateUnit(id, { owner: currentUser, date: actionDate, availableFrom: null }))
                }
                setConfirm(null)
                setSelectedGroupId(null)
                setSelectedTargetKey(null)
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div className="modal-overlay" onClick={() => setNotification(null)}>
          <div className="modal notification-modal" onClick={e => e.stopPropagation()}>
            <h3 className="notification-title">{notification.title}</h3>
            <div className="notification-body">
              {notification.lines.length === 1
                ? <p>{notification.lines[0]}</p>
                : <ul>{notification.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              }
            </div>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button className="primary-btn" onClick={() => setNotification(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
