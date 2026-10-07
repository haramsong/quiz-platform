const API = import.meta.env.VITE_API_URL;

async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { code: data?.error?.code, status: res.status });
  return data;
}

export const api = {
  join: (code, nickname) => call('/sessions/join', { method: 'POST', body: { code, nickname } }),
  postQuiz: (code, pin, body) => call('/quizzes', { method: 'POST', headers: { 'x-host-auth': `${code}:${pin}` }, body: { code, ...body } }),
  getQuiz: (code, pin) => call(`/quizzes/${encodeURIComponent(code)}`, { headers: { 'x-host-auth': `${code}:${pin}` } }),
};
