// Which AI services the MITRA API can reach with its own server-held keys.
// The browser never holds those keys: when a service is available here, its
// calls go through /api/ai/* and the server adds the key. `llm` is the
// reasoning model, named neutrally so the browser never sees the vendor.
let status = { llm: false, sarvam: false };

export const setAiStatus = (value) => { status = { llm: Boolean(value?.llm), sarvam: Boolean(value?.sarvam) }; };
export const serverAi = () => status;
