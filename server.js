const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.text({ type: '*/*', limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const TCP_PORT = 69;

// In-memory store untuk paste
// Struktur: { id: { content: string, createdAt: Date, timeout: TimeoutObject } }
const pastes = {};

// Rate limiter: 100 requests per 15 menit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Fungsi untuk menghapus paste setelah 15 menit (900000 ms)
const scheduleExpiration = (id) => {
  // Jika sudah ada timer, clear dulu
  if (pastes[id].timeout) clearTimeout(pastes[id].timeout);
  pastes[id].timeout = setTimeout(() => {
    console.log(`Paste ${id} expired.`);
    delete pastes[id];
  }, 15 * 60 * 1000); // 15 menit
};

// Aktifkan middleware untuk parsing body sebagai plain text
app.use(express.text({ type: '*/*' }));

// Sajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint untuk halaman utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint untuk mengakses paste berdasarkan id
app.get('/:id', (req, res) => {
  const id = req.params.id;
  if (!pastes[id]) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MyPastebin - Paste Not Found</title>
      <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&family=Roboto:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Roboto', sans-serif;
          margin: 0;
          padding: 0;
          background-color: #282a36;
          color: #f8f8f2;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .container {
          width: 90%;
          max-width: 600px;
          padding: 2rem;
          background-color: #44475a;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          text-align: center;
        }
        h1 {
          color: #ff5555;
          margin-bottom: 1rem;
          font-size: 2rem;
        }
        p {
          margin-bottom: 1.5rem;
        }
        .btn {
          display: inline-block;
          padding: 10px 20px;
          background-color: #6272a4;
          color: #f8f8f2;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          text-decoration: none;
          transition: background-color 0.3s;
        }
        .btn:hover {
          background-color: #26386f;
        }
        @media (max-width: 480px) {
          .container {
            padding: 1rem;
          }
          h1 {
            font-size: 1.5rem;
          }
          p {
            font-size: 0.9rem;
          }
          .btn {
            padding: 8px 16px;
            font-size: 12px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Paste Not Found</h1>
        <p>The paste you're looking for doesn't exist or has expired.</p>
        <a href="/" class="btn">Back to Home</a>
      </div>
    </body>
    </html>
  `;
    return res.status(404).send(html);
  }

  // Increment view count
  pastes[id].views = (pastes[id].views || 0) + 1;

  // Render halaman HTML dengan kode, tombol copy, dan syntax highlighting
  const content = pastes[id].content;
  const views = pastes[id].views;
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Paste Id: ${id}</title>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/theme/dracula.min.css">
    <style>
      body {
        font-family: 'Roboto', sans-serif;
        margin: 0;
        padding: 0;
        background-color: #282a36;
        color: #f8f8f2;
      }
      .container {
        max-width: 90%;
        margin: 1rem auto;
        padding: 1rem;
        background-color: #44475a;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }
      h1 {
        text-align: center;
        color: #8be9fd;
        margin-bottom: 1rem;
        font-size: 2rem;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      .btn {
        display: inline-block;
        padding: 10px 20px;
        background-color: #6272a4;
        color: #f8f8f2;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        text-decoration: none;
        transition: background-color 0.3s;
      }
      .btn:hover {
        background-color: #26386f;
      }
      .back-btn {
        background-color: #6272a4;
      }
      .copy-btn {
        background-color:rgb(15, 175, 55);
        color: #282a36;
      }
      .copy-btn:hover {
        background-color: #228443;
      }
      .editor-container {
        border: 1px solid #6272a4;
        border-radius: 4px;
        overflow: hidden;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
      }
      .CodeMirror {
        height: auto;
        font-family: 'Fira Code', monospace;
        font-size: 14px;
        line-height: 1.6;
      }
        .paste-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          font-size: 0.9rem;
          color: #bd93f9;
        }
        views {
          display: flex;
          align-items: center;
        }
        .views svg {
          margin-right: 5px;
        }
      @media (max-width: 600px) {
        .container {
          padding: 0.5rem;
        }
        h1 {
          font-size: 1.5rem;
        }
        .header {
          flex-direction: column;
          align-items: stretch;
        }
        .btn {
          width: 100%;
          margin-bottom: 0.5rem;
        }
        .paste-info {
          flex-direction: column;
          align-items: flex-start;
        }
        .views {
          margin-top: 0.5rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Orion Paste</h1>
      <div class="header">
        <h2>Paste: ${id}</h2>
        <div>
          <a class="btn back-btn" href="/">Back</a>
          <button id="btn-copy" class="btn copy-btn" onclick="copyToClipboard()">Copy</button>
        </div>
      </div>
      <div class="paste-info">
        <span>Created: ${new Date(pastes[id].createdAt).toLocaleString()}</span>
        <span class="views">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          ${views} view${views !== 1 ? 's' : ''}
        </span>
      </div>
      <div class="editor-container">
        <textarea id="code-area">${escapeHtml(content)}</textarea>
      </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/javascript/javascript.min.js"></script>
    <script>
      var editor = CodeMirror.fromTextArea(document.getElementById("code-area"), {
        lineNumbers: true,
        mode: "javascript",
        theme: "dracula",
        readOnly: true
      });

      function copyToClipboard() {
        const code = editor.getValue();
        const btnCopy = document.getElementById('btn-copy');

        navigator.clipboard.writeText(code).then(function() {
          btnCopy.innerText = 'Copied!';
          btnCopy.style.backgroundColor = '#50fa7b';
          btnCopy.style.color = '#282a36';

          setTimeout(() => {
            btnCopy.innerText = 'Copy';
            btnCopy.style.backgroundColor = '';
            btnCopy.style.color = '';
          }, 2000);
        }, function(err) {
          console.error('Failed to copy text: ', err);
          btnCopy.innerText = 'Error!';
          btnCopy.style.backgroundColor = '#ff5555';

          setTimeout(() => {
            btnCopy.innerText = 'Copy';
            btnCopy.style.backgroundColor = '';
          }, 10000);
        });
      }
    </script>
  </body>
  </html>
`;
  res.send(html);
});

// Endpoint untuk menerima paste melalui HTTP POST (misalnya dari form web atau curl)
app.post('/paste', (req, res) => {
  const content = req.body;
  if (!content) {
    return res.status(400).send('Tidak ada konten.');
  }

  // Buat id random (misal 6 karakter hex)
  const id = crypto.randomBytes(3).toString('hex');
  pastes[id] = { content, createdAt: new Date(), views: 0 };
  scheduleExpiration(id);
  // const pasteUrl = `http://localhost:3000/${id}`;
  const pasteUrl = `https://paste-orion.vercel.app/${id}`;
  res.json({ url: pasteUrl, id: id });
});

app.listen(PORT, () => {
  console.log(`HTTP server berjalan di port ${PORT}`);
});

// Fungsi untuk meng-escape HTML agar karakter khusus tidak dieksekusi
function escapeHtml(text) {
  if (!text) return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
