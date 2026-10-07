// Presign then upload image blob to S3.
const API = import.meta.env.VITE_API_URL;

export async function uploadImage({ code, pin, purpose, order, blob }) {
  // 1. get presigned URL
  const presignRes = await fetch(`${API}/quizzes/${encodeURIComponent(code)}/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-host-auth': `${code}:${pin}` },
    body: JSON.stringify({ purpose, order, contentType: 'image/webp' }),
  });
  if (!presignRes.ok) throw new Error('presign failed');
  const { uploadUrl, imageKey } = await presignRes.json();
  // 2. PUT blob directly to S3
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/webp' },
    body: blob,
  });
  if (!putRes.ok) throw new Error('upload failed');
  return imageKey;
}
