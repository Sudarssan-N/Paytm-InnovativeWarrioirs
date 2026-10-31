// The signed-in account on this device. The token is a convenience for this browser
// only; the server decides what it is worth, and it lapses after seven days.
const KEY = 'mitra_token';

export function getToken() {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(token) {
  try { if (token) window.localStorage.setItem(KEY, token); else window.localStorage.removeItem(KEY); } catch { /* private mode: this tab only */ }
}
export const authHeaders = () => {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

export async function authApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/auth${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.title || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const readFiles = (files) => Promise.all(files.slice(0, 5).map((file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, mime: file.type, data: String(reader.result).split(',')[1] });
  reader.onerror = () => reject(new Error(`Could not open ${file.name}`));
  reader.readAsDataURL(file);
})));

export const SAMPLE_PAPERS = {
  rider: [['sample-rider-statement.pdf', 'application/pdf'], ['sample-rider-receipt-payout.png', 'image/png'], ['sample-rider-receipt-kumar.png', 'image/png'], ['sample-rider-itr.pdf', 'application/pdf']],
  kirana: [['sample-kirana-statement.pdf', 'application/pdf'], ['sample-kirana-gst.pdf', 'application/pdf']],
};
export const sampleFiles = (set) => Promise.all(SAMPLE_PAPERS[set].map(async ([name, type]) => new File([await (await fetch(`/samples/${name}`)).blob()], name, { type })));
