import jsQR from 'jsqr';

self.onmessage = (e) => {
  const { width, height, data } = e.data;
  if (!data || !data.length) {
    self.postMessage(null);
    return;
  }
  const code = jsQR(data, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  self.postMessage(code ? code.data : null);
};
