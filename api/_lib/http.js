export const json = (res, statusCode, payload) => {
  res.status(statusCode).json(payload);
};

export const methodNotAllowed = (res, allowedMethods) => {
  res.setHeader('Allow', allowedMethods.join(', '));
  return json(res, 405, { error: 'Method not allowed.' });
};

export const parseBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  return {};
};

export const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export const handleRouteError = (res, error, fallbackMessage) => {
  const status = typeof error?.status === 'number' ? error.status : 500;
  const message =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message
      : fallbackMessage;
  return json(res, status, { error: message });
};
