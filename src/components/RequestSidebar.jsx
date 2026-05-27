import React, { useState, useEffect } from 'react'

const STATUS_LABEL = { allocated: 'Allocated', rejected: 'Rejected', pending: 'Pending' }
const STATUS_CLASS = { allocated: 'status-badge--ok', rejected: 'status-badge--rejected', pending: 'status-badge--pending' }

export default function RequestSidebar({ requests = [], allUnits = [], currentUser, onSubmit, pickedGroupId, onHighlightUnits }) {
  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    name: currentUser || '',
    currentGroupId: '',
    desiredCount: 4,
    desiredFloor: 0,
    reservationDate: today,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (currentUser) setForm(f => ({ ...f, name: currentUser }))
  }, [currentUser])

  useEffect(() => {
    if (pickedGroupId && picking) {
      setForm(f => ({ ...f, currentGroupId: pickedGroupId }))
      setPicking(false)
    }
  }, [pickedGroupId, picking])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim() || !form.reservationDate) return
    setLoading(true)
    setError(null)
    try {
      await onSubmit({ ...form, name: form.name.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="ai-section">
      <div className="ai-section-header">
        <span className="ai-kicker">Powered by Ollama</span>
        <h2 className="ai-title">AI Unit Allocation</h2>
        <p className="ai-subtitle">Submit a request and the local LLM will match it against current availability.</p>
      </div>

      <div className="ai-body">
        {/* ── Form ── */}
        <div className="ai-form-panel">
          <h3 className="ai-panel-title">New Request</h3>
          <form className="request-form" onSubmit={handleSubmit}>

            <div className="form-field">
              <label className="form-label" htmlFor="req-name">Name</label>
              <input
                id="req-name"
                className="form-input"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Your name"
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">Current unit (cell)</label>
              <div className="cell-picker">
                <div className={`cell-picker-display ${picking ? 'cell-picker-display--active' : ''}`}>
                  {form.currentGroupId
                    ? <span className="cell-picker-value">{form.currentGroupId}</span>
                    : <span className="cell-picker-placeholder">
                        {picking ? 'Now click a cell on the floor plan above…' : 'No cell selected'}
                      </span>
                  }
                </div>
                <div className="cell-picker-actions">
                  <button
                    type="button"
                    className={`cell-picker-btn ${picking ? 'cell-picker-btn--cancel' : ''}`}
                    onClick={() => setPicking(p => !p)}
                  >
                    {picking ? 'Cancel' : form.currentGroupId ? 'Change' : 'Pick from map'}
                  </button>
                  {form.currentGroupId && !picking && (
                    <button type="button" className="cell-picker-clear" onClick={() => set('currentGroupId', '')}>✕</button>
                  )}
                </div>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="req-count">Desired size</label>
              <select id="req-count" className="form-input" value={form.desiredCount} onChange={e => set('desiredCount', Number(e.target.value))}>
                <option value={2}>Half unit — 2 sub-units</option>
                <option value={4}>Full unit — 4 sub-units</option>
                <option value={8}>Double unit — 8 sub-units</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="req-floor">Target floor</label>
              <select id="req-floor" className="form-input" value={form.desiredFloor} onChange={e => set('desiredFloor', Number(e.target.value))}>
                <option value={0}>Ground floor (Level 0)</option>
                <option value={1}>Upper floor (Level 1)</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="req-date">Reservation date</label>
              <input
                id="req-date"
                className="form-input"
                type="date"
                value={form.reservationDate}
                min={today}
                onChange={e => set('reservationDate', e.target.value)}
                required
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button className="primary-btn req-submit-btn" type="submit" disabled={loading || !form.name.trim()}>
              {loading ? (
                <><span className="spinner" /> Asking AI…</>
              ) : 'Submit Request'}
            </button>
          </form>
        </div>

        {/* ── History ── */}
        <div className="ai-history-panel">
          <h3 className="ai-panel-title">Request History</h3>
          {requests.length === 0 ? (
            <p className="history-empty">No requests yet. Submit one above.</p>
          ) : (
            <>
              <LatestResult r={[...requests].reverse()[0]} onHighlightUnits={onHighlightUnits} />
              <ul className="history-list">
                {[...requests].reverse().map(r => <RequestItem key={r.id} r={r} onHighlightUnits={onHighlightUnits} />)}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function LatestResult({ r, onHighlightUnits }) {
  if (!r) return null
  return (
    <div className={`ai-result-card ai-result-card--${r.status}`}>
      <div className="ai-result-header">
        <span className={`status-badge ${STATUS_CLASS[r.status] || ''}`}>
          {STATUS_LABEL[r.status] || r.status}
        </span>
        <span className="ai-result-meta">
          {r.name} · Floor {r.desiredFloor} · {r.desiredCount} sub-units · {r.reservationDate}
        </span>
      </div>
      <p className="ai-result-reasoning">
        {r.reasoning || 'No reasoning provided.'}
      </p>
      {r.assignUnitIds?.length > 0 && (
        <div className="ai-result-row">
          <span className="ai-result-row-label">Assigned</span>
          <div className="unit-chip-group">
            {r.assignUnitIds.map(id => (
              <button key={id} className="unit-chip" onClick={() => onHighlightUnits?.(r.assignUnitIds)}>
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
      {r.releaseUnitIds?.length > 0 && (
        <div className="ai-result-row">
          <span className="ai-result-row-label">Released</span>
          <div className="unit-chip-group">
            {r.releaseUnitIds.map(id => (
              <button key={id} className="unit-chip unit-chip--release" onClick={() => onHighlightUnits?.(r.releaseUnitIds)}>
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="ai-result-ts">{new Date(r.createdAt).toLocaleString()}</p>
    </div>
  )
}

function RequestItem({ r, onHighlightUnits }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="history-item">
      <button className="history-item-toggle" onClick={() => setOpen(o => !o)}>
        <span className="history-item-who">
          <strong>{r.name}</strong>
          <span className="history-item-meta">
            Floor {r.desiredFloor} · {r.desiredCount} sub-units · {r.reservationDate}
          </span>
        </span>
        <span className={`status-badge ${STATUS_CLASS[r.status] || ''}`}>
          {STATUS_LABEL[r.status] || r.status}
        </span>
        <span className="history-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="history-item-body">
          {r.reasoning && <p className="history-reasoning">{r.reasoning}</p>}
          {r.assignUnitIds?.length > 0 && (
            <div className="history-units">
              <strong>Assigned: </strong>
              <span className="unit-chip-group unit-chip-group--inline">
                {r.assignUnitIds.map(id => (
                  <button key={id} className="unit-chip unit-chip--sm" onClick={() => onHighlightUnits?.(r.assignUnitIds)}>
                    {id}
                  </button>
                ))}
              </span>
            </div>
          )}
          {r.releaseUnitIds?.length > 0 && (
            <div className="history-units">
              <strong>Released: </strong>
              <span className="unit-chip-group unit-chip-group--inline">
                {r.releaseUnitIds.map(id => (
                  <button key={id} className="unit-chip unit-chip--sm unit-chip--release" onClick={() => onHighlightUnits?.(r.releaseUnitIds)}>
                    {id}
                  </button>
                ))}
              </span>
            </div>
          )}
          <p className="history-ts">{new Date(r.createdAt).toLocaleString()}</p>
        </div>
      )}
    </li>
  )
}
