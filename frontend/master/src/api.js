// Master console API client. All requests carry the X-Master-Key header.
const API = import.meta.env.VITE_API_URL;

async function call(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-master-key': key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const code = data?.error?.code || `HTTP_${res.status}`;
    const message = data?.error?.message || res.statusText;
    const err = new Error(message);
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  listCodes: (key) => call('/codes', { key }),
  issueCode: (key, body) => call('/codes', { method: 'POST', key, body }),
  deleteCode: (key, code) =>
    call(`/codes/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      key,
      body: { confirm: code },
    }),
  resetCode: (key, code, force = false) =>
    call(`/codes/${encodeURIComponent(code)}/reset`, {
      method: 'POST',
      key,
      body: { confirm: code, force },
    }),
};
