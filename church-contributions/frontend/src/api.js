// Talks to the backend. Keeps the login token and signs the user out if it stops working.

const TOKEN_KEY = 'cc_token';

function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const session = {
  token: readToken(),
  onUnauthorized: null,
  set(token) {
    this.token = token;
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage blocked: the login simply will not survive a reload */
    }
  },
  clear() {
    this.token = null;
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || null; // the full error body, for example the list of bad rows in a bulk import
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }

  if (!res.ok) {
    if (res.status === 401 && session.token && path !== '/auth/login' && session.onUnauthorized) {
      session.onUnauthorized();
    }
    // A server error with no message from our API usually means the backend is not running.
    const backendDown = !data && res.status >= 500;
    throw new ApiError(
      backendDown
        ? 'Cannot reach the server. Make sure the backend is running, then try again.'
        : (data && data.error) || 'Something went wrong. Please try again.',
      res.status,
      data
    );
  }
  return data;
}

// Downloads a file from the backend (it needs the login token, so a plain link will not do).
async function download(path) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0);
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* no body */
    }
    if (res.status === 401 && session.onUnauthorized) session.onUnauthorized();
    throw new ApiError((data && data.error) || 'Could not create the file. Please try again.', res.status, data);
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : 'contributions.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return link.download;
}

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),
  contributionTypes: () => request('GET', '/contribution-types?active=true'),
  members: () => request('GET', '/members?active=true'),
  monthly: (contributionTypeId, month) =>
    request('GET', `/reports/monthly?contributionTypeId=${encodeURIComponent(contributionTypeId)}&month=${month}`),
  summary: (period) => request('GET', `/reports/summary?${period.year ? `year=${period.year}` : `month=${period.month}`}`),
  exportExcel: (period) =>
    download(`/reports/export?${period.year ? `year=${period.year}` : `month=${period.month}`}`),
  recentPayments: (limit = 10) => request('GET', `/payments?limit=${limit}&includeVoided=true`),
  createPayment: (body) => request('POST', '/payments', body),
  voidPayment: (id, reason) => request('POST', `/payments/${encodeURIComponent(id)}/void`, { reason }),

  users: () => request('GET', '/users'),
  addUser: (body) => request('POST', '/users', body),
  updateUser: (id, body) => request('PATCH', `/users/${encodeURIComponent(id)}`, body),

  allMembers: () => request('GET', '/members'),
  addMember: (body) => request('POST', '/members', body),
  addMembers: (members) => request('POST', '/members/bulk', { members }),
  updateMember: (id, body) => request('PATCH', `/members/${encodeURIComponent(id)}`, body),

  allContributionTypes: () => request('GET', '/contribution-types'),
  addContributionType: (body) => request('POST', '/contribution-types', body),
  updateContributionType: (id, body) => request('PATCH', `/contribution-types/${encodeURIComponent(id)}`, body),
};
