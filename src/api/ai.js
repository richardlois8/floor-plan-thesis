// Ollama local LLM integration — no API key required.
// Requires Ollama running at localhost:11434 with a model pulled, e.g.:
//   ollama pull llama3
//
// Override defaults via .env:
//   VITE_OLLAMA_URL=http://localhost:11434
//   VITE_OLLAMA_MODEL=llama3

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'llama3'

const SYSTEM_PROMPT = `You are a unit allocation assistant for a two-floor apartment building.

Building layout:
- Level 0 = Ground floor, Level 1 = Upper floor
- Each level has a 6-column x 2-row grid of cells
- Each cell has 4 sub-units: Q0 (top-left), Q1 (top-right), Q2 (bottom-left), Q3 (bottom-right)
- Sub-unit ID format: L{level}-CR{cellRow}-CC{cellCol}-Q{0..3}  (example: L0-CR0-CC2-Q1)

Availability: a sub-unit is available when owner is null AND (availableFrom is null OR availableFrom <= reservationDate).

Task: given a request, find available sub-units on the target floor to satisfy desiredCount.
- If the requester already owns more units than desired, list units to release in releaseUnitIds.
- If no valid allocation exists, set decision to "reject".

You MUST respond with ONLY this exact JSON structure — no markdown, no extra text:
{"decision":"allocate","assignUnitIds":["L0-CR0-CC1-Q0","L0-CR0-CC1-Q1"],"releaseUnitIds":[],"reasoning":"Found 2 free sub-units on Level 0."}

Rules:
- "decision" must be exactly the string "allocate" or "reject"
- "assignUnitIds" must be an array of sub-unit ID strings (can be empty)
- "releaseUnitIds" must be an array of sub-unit ID strings (can be empty)
- "reasoning" must be a short string`

// Normalize field names from models that use different casing or naming conventions
function normalizeResult(raw) {
  const find = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined) return raw[k]
    }
    return undefined
  }

  const decision = find('decision', 'result', 'action', 'allocation', 'status')
  const assignRaw = find('assignUnitIds', 'assign_unit_ids', 'assignedUnits', 'assigned_units', 'assign', 'units_to_assign', 'unitsToAssign')
  const releaseRaw = find('releaseUnitIds', 'release_unit_ids', 'releasedUnits', 'released_units', 'release', 'units_to_release', 'unitsToRelease')
  const reasoning = find('reasoning', 'reason', 'explanation', 'rationale', 'justification', 'message') || ''

  if (!decision) {
    console.error('[ai.js] Unexpected model response shape:', JSON.stringify(raw))
    throw new Error(`Model response is missing a "decision" field. Raw response logged to console.`)
  }

  const normalizedDecision = String(decision).toLowerCase().includes('alloc') ? 'allocate' : 'reject'

  return {
    decision: normalizedDecision,
    assignUnitIds: Array.isArray(assignRaw) ? assignRaw : [],
    releaseUnitIds: Array.isArray(releaseRaw) ? releaseRaw : [],
    reasoning,
  }
}

export async function evaluateRequest({ request, allUnits, existingRequests }) {
  const unitSummary = allUnits.map(u => ({
    id: u.id,
    level: u.level,
    cellRow: u.cellR,
    cellCol: u.cellC,
    quadrant: u.q,
    owner: u.owner || null,
    availableFrom: u.availableFrom || null,
  }))

  const requesterCurrentUnits = allUnits
    .filter(u => u.owner === request.name)
    .map(u => u.id)

  const previousAllocations = existingRequests
    .filter(r => r.status === 'allocated')
    .map(r => ({ name: r.name, assignUnitIds: r.assignUnitIds, date: r.reservationDate }))

  const userMessage = `Unit occupancy (${allUnits.length} sub-units):
${JSON.stringify(unitSummary)}

Previous allocations: ${JSON.stringify(previousAllocations)}

Request:
- name: ${request.name}
- currentlyOwns: ${requesterCurrentUnits.length > 0 ? requesterCurrentUnits.join(', ') : 'none'}
- currentCell: ${request.currentGroupId || 'none'}
- desiredCount: ${request.desiredCount} sub-units total
- desiredFloor: ${request.desiredFloor}
- reservationDate: ${request.reservationDate}

Reply with ONLY the JSON object described in the system prompt.`

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      format: 'json',
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Ollama error ${response.status}: ${text || response.statusText}`)
  }

  const data = await response.json()
  const raw = data?.message?.content ?? data?.response ?? ''

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('[ai.js] Model returned no JSON. Full response:', raw)
    throw new Error('Model returned no JSON. Make sure Ollama is running and the model is pulled.')
  }

  const parsed = JSON.parse(jsonMatch[0])
  return normalizeResult(parsed)
}
