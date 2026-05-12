import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SVG } from '@svgdotjs/svg.js'

export default function FloorPlan({ levels, hallways, onUpdateUnit, currentUser, resetApp }) {
  const [selectedGroupId, setSelectedGroupId] = useState(null) // cell group
  const [selectedTargetKey, setSelectedTargetKey] = useState(null) // which pair user picked
  const [confirm, setConfirm] = useState(null) // { fromGroupId, target }

  const hostRef = useRef(null)
  const drawRef = useRef(null)
  const unitElsRef = useRef(new Map()) // id -> { rect, label }
  const targetElsRef = useRef(new Map()) // key -> svg.js element
  const cellElsRef = useRef(new Map()) // groupId -> svg.js element

  const flatUnits = useMemo(() => levels.flatMap(level => level.units), [levels])
  const unitsById = useMemo(() => new Map(flatUnits.map(u => [u.id, u])), [flatUnits])

  const selectUnit = u => {
    setSelectedGroupId(u.groupId || null)
    setSelectedTargetKey(null)
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
    // Targets are size-2 subsets. We'll support these upgrade types:
    // - same-level: claim any horizontal pair (top row 2, bottom row 2) inside an empty cell
    // - vertical: claim a pair of subunits in the same quadrant row/col from the cell above/below (same cellR/cellC)
    //
    // Each target is { key, kind, level, cellR, cellC, unitIds[] }
    const targets = []
    if (!selectedGroupId) return targets
    if (!currentUser) return targets
    if (!isFullCellOwnedByUser(selectedGroupId)) return targets

    const from = groupUnits.get(selectedGroupId)
    if (!from || from.length !== 4) return targets
    const anyFrom = from[0]

    // helper to add if available
    const addIfAvailable = (t) => {
      if (!t.unitIds.every(id => !unitsById.get(id)?.owner)) return

      // distance from selected cell center to the target bbox center
      const fromItems = from
      const fromMinX = Math.min(...fromItems.map(i => i.x))
      const fromMinY = Math.min(...fromItems.map(i => i.y))
      const fromMaxX = Math.max(...fromItems.map(i => i.x + i.w))
      const fromMaxY = Math.max(...fromItems.map(i => i.y + i.h))
      const fromCx = (fromMinX + fromMaxX) / 2
      const fromCy = (fromMinY + fromMaxY) / 2

      const items = t.unitIds.map(id => unitsById.get(id)).filter(Boolean)
      const minX = Math.min(...items.map(i => i.x))
      const minY = Math.min(...items.map(i => i.y))
      const maxX = Math.max(...items.map(i => i.x + i.w))
      const maxY = Math.max(...items.map(i => i.y + i.h))
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const dist = Math.round(Math.hypot(cx - fromCx, cy - fromCy))

      targets.push({ ...t, distance: dist })
    }

    // same-level, empty cells anywhere: choose any cell, take two subunits (top row or bottom row)
    for (const [gid, g] of groupUnits.entries()) {
      if (gid === selectedGroupId) continue
      const cellOwner = getGroupOwner(gid)
      if (cellOwner) continue // occupied cell

      // ensure fully empty
      if (!g.every(x => !x.owner)) continue

      // top row pair: q0 + q1 ; bottom row pair: q2 + q3
      const q0 = g.find(x => x.q === 0)?.id
      const q1 = g.find(x => x.q === 1)?.id
      const q2 = g.find(x => x.q === 2)?.id
      const q3 = g.find(x => x.q === 3)?.id
  if (q0 && q1) addIfAvailable({ key: `HL:${gid}:top`, kind: 'same-level', label: `${gid} (top pair)`, unitIds: [q0, q1] })
  if (q2 && q3) addIfAvailable({ key: `HL:${gid}:bot`, kind: 'same-level', label: `${gid} (bottom pair)`, unitIds: [q2, q3] })
    }

    // vertical extension: same cellR/cellC but other level; pick a pair by column (left col q0+q2) or right col (q1+q3)
    const otherLevel = anyFrom.level === 0 ? 1 : 0
    const otherGid = `L${otherLevel}-CR${anyFrom.cellR}-CC${anyFrom.cellC}`
    const other = groupUnits.get(otherGid)
    if (other && other.length === 4 && other.every(x => !x.owner)) {
      const left = [other.find(x => x.q === 0)?.id, other.find(x => x.q === 2)?.id].filter(Boolean)
      const right = [other.find(x => x.q === 1)?.id, other.find(x => x.q === 3)?.id].filter(Boolean)
      if (left.length === 2) addIfAvailable({ key: `V:${otherGid}:left`, kind: 'vertical', label: `${otherGid} (left col)`, unitIds: left, dir: anyFrom.level === 0 ? 'below' : 'above' })
      if (right.length === 2) addIfAvailable({ key: `V:${otherGid}:right`, kind: 'vertical', label: `${otherGid} (right col)`, unitIds: right, dir: anyFrom.level === 0 ? 'below' : 'above' })
    }

    // sort by distance so the picker is useful
    return targets.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
  }, [selectedGroupId, currentUser, groupUnits, unitsById])

  const submitUpgrade = () => {
  if (!selectedGroupId) return
  if (!currentUser) return alert('Please set your user name first')
  if (!isFullCellOwnedByUser(selectedGroupId)) return alert('You must own the full 4-unit cell before upgrading')
  if (!eligibleTargets.length) return alert('No eligible upgrade targets available')

  const target = eligibleTargets.find(t => t.key === selectedTargetKey) || eligibleTargets[0]
  setSelectedTargetKey(target.key)
  setConfirm({ fromGroupId: selectedGroupId, target })
  }

  const toggleClaim = u => {
    if (!currentUser) return alert('Set your user name to claim a unit')
  // claim/release single sub-units for testing; real flow expects full-cell ownership.
  if (!u.owner) onUpdateUnit(u.id, { owner: currentUser })
  else if (u.owner === currentUser) onUpdateUnit(u.id, { owner: null })
  else alert('This unit is owned by ' + u.owner)
  }

  // Calculate viewBox size based on units extents
  const viewBox = useMemo(() => {
    const padding = 40
    const xs = flatUnits.map(u => [u.x, u.x + u.w]).flat()
    const ys = flatUnits.map(u => [u.y, u.y + u.h]).flat()
    const minX = Math.max(0, Math.min(...xs) - padding)
    const minY = Math.max(0, Math.min(...ys) - padding)
    const maxX = Math.max(...xs) + padding
    const maxY = Math.max(...ys) + padding
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
  }, [flatUnits])

  // (Re)draw using svg.js
  useEffect(() => {
    if (!hostRef.current) return

    // clear previous drawing
    hostRef.current.innerHTML = ''
    unitElsRef.current = new Map()

    const draw = SVG().addTo(hostRef.current).viewbox(viewBox).addClass('floorplan-svg-impl')
    drawRef.current = draw

  // clear target overlays
  targetElsRef.current = new Map()
    cellElsRef.current = new Map()

    // hallway/service zones
    if (hallways?.length) {
      hallways.forEach(h => {
        const zone = draw
          .rect(h.w, h.h)
          .move(h.x, h.y)
          .radius(14)
          .fill('rgba(120,160,200,0.12)')
          .stroke({ color: 'rgba(80,120,160,0.45)', width: 1, dasharray: [8, 6] })

        zone.addClass('hallway-rect')

        if (h.label) {
          draw
            .text(h.label)
            .move(h.x + 12, h.y + 10)
            .font({ size: 13, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
            .fill('rgba(40,60,80,0.75)')
        }
      })
    }

    // level headers + separator
    const levels = new Map()
    flatUnits.forEach(u => {
      const cur = levels.get(u.level) || {
        minX: u.x,
        minY: u.y,
        maxX: u.x + u.w,
        maxY: u.y + u.h
      }
      cur.minX = Math.min(cur.minX, u.x)
      cur.minY = Math.min(cur.minY, u.y)
      cur.maxX = Math.max(cur.maxX, u.x + u.w)
      cur.maxY = Math.max(cur.maxY, u.y + u.h)
      levels.set(u.level, cur)
    })

    const orderedLevels = [...levels.entries()].sort((a, b) => a[0] - b[0])
    orderedLevels.forEach(([level, box]) => {
      const padX = 30
      const padY = 34
      const bandY = box.minY - 44
      const bandW = (box.maxX - box.minX) + padX * 2
      const bandH = (box.maxY - box.minY) + padY * 2
      const bandX = box.minX - padX
      const labelText = level === 0 ? 'Level 1 (Ground Floor)' : 'Level 2'

      draw
        .rect(bandW, bandH)
        .move(bandX, box.minY - padY)
        .radius(20)
        .fill(level === 0 ? 'rgba(220,235,250,0.65)' : 'rgba(230,235,245,0.7)')
        .stroke({ color: 'rgba(30,40,60,0.35)', width: 1 })

      draw
        .rect(bandW, 30)
        .move(bandX, bandY)
        .radius(10)
        .fill(level === 0 ? 'rgba(40,120,200,0.32)' : 'rgba(70,90,120,0.32)')
        .stroke({ color: 'rgba(40,60,80,0.55)', width: 1 })

      draw
        .text(labelText)
        .move(bandX + 14, bandY + 6)
        .font({ size: 14, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
        .fill('rgba(25,35,55,0.9)')

      // draw
      //   .text(level === 0 ? 'FIRST FLOOR' : 'SECOND FLOOR')
      //   .move(bandX + 12, box.minY + (box.maxY - box.minY) / 2 - 10)
      //   .font({ size: 12, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
      //   .fill('rgba(25,35,55,0.75)')
    })

    if (orderedLevels.length >= 2) {
      const upper = orderedLevels[0][1]
      const lower = orderedLevels[1][1]
      const gapH = Math.max(0, lower.minY - upper.maxY)
      if (gapH > 40) {
        draw
          .rect(upper.maxX - upper.minX, gapH)
          .move(upper.minX, upper.maxY)
          .radius(14)
          .fill('rgba(30,40,60,0.08)')
          .stroke({ color: 'rgba(30,40,60,0.3)', width: 1, dasharray: [10, 10] })

        draw
          .text('FLOOR BREAK')
          .move(upper.minX + 12, upper.maxY + gapH / 2 - 7)
          .font({ size: 12, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
          .fill('rgba(30,40,60,0.8)')
      }
    }

    // cell boundaries (show users the 4-unit cell grouping)
    for (const [gid, g] of groupUnits.entries()) {
      const minX = Math.min(...g.map(i => i.x))
      const minY = Math.min(...g.map(i => i.y))
      const maxX = Math.max(...g.map(i => i.x + i.w))
      const maxY = Math.max(...g.map(i => i.y + i.h))
      const pad = 10
      const isSelected = gid === selectedGroupId

      const boundary = draw
        .rect((maxX - minX) + pad * 2, (maxY - minY) + pad * 2)
        .move(minX - pad, minY - pad)
        .radius(14)
        .fill('transparent')
        .stroke({
          color: isSelected ? '#ff8a00' : 'rgba(0,0,0,0.15)',
          width: isSelected ? 3 : 1,
          dasharray: [4, 6]
        })

      cellElsRef.current.set(gid, boundary)
    }

    // units
    flatUnits.forEach(u => {
      const occupied = !!u.owner
      const rect = draw
        .rect(u.w, u.h)
        .move(u.x, u.y)
        .radius(10)
        .fill(occupied ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.35)')
        .stroke({ color: occupied ? '#000' : '#2b8fff', width: occupied ? 2 : 2 })

      rect.attr({ 'data-id': u.id })
      rect.css({ cursor: occupied ? 'not-allowed' : 'pointer' })

      const label = draw
        .text(u.id)
        .move(u.x + 10, u.y + 10)
        .font({ size: 14, family: 'Inter, Segoe UI, Arial', anchor: 'start' })
        .fill(occupied ? '#fff' : '#222')

      // hover animations
      rect.on('mouseenter', () => {
        rect.stroke({ width: 4, color: occupied ? '#111' : '#ff8a00' })
      })
      rect.on('mouseleave', () => {
  const isInSelCell = selectedGroupId && u.groupId === selectedGroupId
  rect.stroke({ width: isInSelCell ? 4 : 2, color: occupied ? '#000' : '#2b8fff' })
      })

      // click handlers
      rect.on('click', () => {
  // selecting any sub-unit selects the whole cell
        selectUnit(u)
      })
      rect.on('dblclick', e => {
        e.preventDefault()
        toggleClaim(u)
      })

      unitElsRef.current.set(u.id, { rect, label })
    })

    // draw target highlights (behind stroke but above fills)
    // we only draw when there is a selected cell and eligible targets
    if (eligibleTargets.length) {
      eligibleTargets.forEach(t => {
        // compute union bbox of unitIds
        const items = t.unitIds.map(id => unitsById.get(id)).filter(Boolean)
        if (!items.length) return
        const minX = Math.min(...items.map(i => i.x))
        const minY = Math.min(...items.map(i => i.y))
        const maxX = Math.max(...items.map(i => i.x + i.w))
        const maxY = Math.max(...items.map(i => i.y + i.h))
        const pad = 6
        const hl = draw
          .rect((maxX - minX) + pad * 2, (maxY - minY) + pad * 2)
          .move(minX - pad, minY - pad)
          .radius(12)
          .fill('rgba(255,138,0,0.10)')
          .stroke({ color: '#ff8a00', width: 2, dasharray: [6, 6] })

        hl.css({ cursor: 'pointer' })
        hl.on('mouseenter', () => hl.stroke({ width: 4 }))
        hl.on('mouseleave', () => hl.stroke({ width: selectedTargetKey === t.key ? 5 : 2 }))
        hl.on('click', () => {
          setSelectedTargetKey(t.key)
        })

        targetElsRef.current.set(t.key, hl)
      })
    }

    // initial selected cell styling: highlight all 4 subunits if owned
    if (selectedGroupId) {
      const g = groupUnits.get(selectedGroupId) || []
      g.forEach(x => {
        const el = unitElsRef.current.get(x.id)
        if (el) el.rect.stroke({ width: 4, color: '#ff8a00' })
      })
    }

    return () => {
      try { draw.clear() } catch { /* ignore */ }
      drawRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatUnits, viewBox, eligibleTargets, selectedTargetKey, selectedGroupId, groupUnits, unitsById])

  // Animate selection changes (cell selection + target selection)
  useEffect(() => {
    const map = unitElsRef.current
    const selectedUnits = new Set((groupUnits.get(selectedGroupId) || []).map(u => u.id))

    for (const [id, obj] of map.entries()) {
      const u = unitsById.get(id)
      const occupied = !!u?.owner
      const isInSelCell = selectedUnits.has(id)
      const baseStroke = occupied ? '#000' : '#2b8fff'
      const strokeColor = isInSelCell ? '#ff8a00' : baseStroke
      const strokeWidth = isInSelCell ? 4 : 2
      obj.rect.stroke({ width: strokeWidth, color: strokeColor })
    }

    // highlight chosen target
    for (const [key, hl] of targetElsRef.current.entries()) {
      const isSelTarget = key === selectedTargetKey
      hl.stroke({ width: isSelTarget ? 5 : 2 })
      hl.fill({ opacity: isSelTarget ? 0.22 : 0.10 })
    }

    // highlight selected cell boundary
    for (const [gid, boundary] of cellElsRef.current.entries()) {
      const isSelected = gid === selectedGroupId
      boundary.stroke({
        color: isSelected ? '#ff8a00' : 'rgba(0,0,0,0.15)',
        width: isSelected ? 3 : 1
      })
    }
  }, [selectedGroupId, selectedTargetKey, groupUnits, unitsById])

  return (
    <div className="floorplan-wrap">
      <div className="layout">
        <div ref={hostRef} className="floorplan-svg" />

        <aside className="sidepanel">
          <div className="sidepanel-title">Upgrade targets (+2 units)</div>
          {!currentUser && <div className="sidepanel-hint">Set your user name to see targets.</div>}
          {currentUser && !selectedGroupId && <div className="sidepanel-hint">Select your cell (any of its 4 squares).</div>}
          {currentUser && selectedGroupId && !isFullCellOwnedByUser(selectedGroupId) && (
            <div className="sidepanel-hint">You must own all 4 squares of this cell to upgrade.</div>
          )}

          {eligibleTargets.length > 0 ? (
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
                      <span className="pill">{t.kind === 'same-level' ? 'same level' : (t.dir || 'vertical')}</span>
                      <span className="pill">dist {t.distance}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="sidepanel-hint">No valid targets yet.</div>
          )}
        </aside>
      </div>

      <div className="controls">
        <button onClick={submitUpgrade} disabled={!selectedGroupId}>Upgrade (pick 2 units)</button>
        <button onClick={() => {
          if (!selectedGroupId) return
          const any = (groupUnits.get(selectedGroupId) || [])[0]
          if (any) toggleClaim(any)
        }} disabled={!selectedGroupId}>Claim/Release (debug)</button>
        <button onClick={() => { resetApp() }}>Reset</button>
      </div>

      <div className="legend">
        <div><span className="box filled"/> Occupied</div>
        <div><span className="box"/> Available</div>
        <div><span className="box selected"/> Selected</div>
  <div style={{marginLeft:12}}>Tip: click any small square to select its cell. Eligible upgrade targets (2 units) will glow.</div>
      </div>

      {confirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Confirm upgrade</h3>
            <p>
              Upgrade from <strong>{confirm.fromGroupId}</strong> to <strong>{confirm.target.label}</strong>?
            </p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button onClick={() => {
                // perform upgrade: user keeps original 4 units, and gains 2 more units (target pair)
                // This models "extend" behavior: minimum +2 units.
                confirm.target.unitIds.forEach(id => onUpdateUnit(id, { owner: currentUser }))
                setConfirm(null)
                setSelectedGroupId(null)
                setSelectedTargetKey(null)
                alert(`Extension requested: +2 units at ${confirm.target.label}`)
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
