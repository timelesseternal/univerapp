// Reject repeated query keys, coercible objects and non-finite numbers before
// they can become upstream paths or JSON nulls.
export function queryInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return (typeof value === 'string' && /^\d{1,16}$/.test(value) || typeof value === 'number')
    && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export function allowGet(req, res) {
  if (!req.method || req.method === 'GET') return true;
  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: 'method_not_allowed' });
  return false;
}
