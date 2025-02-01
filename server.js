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
    return res.status(404).send('Paste tidak ditemukan atau sudah kedaluwarsa.');
  }

  // Increment view count
  pastes[id].views = (pastes[id].views || 0) + 1;

  // Render halaman HTML dengan kode, tombol copy, dan syntax highlighting
  const content = pastes[id].content;
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Paste ${id}</title>
    <link rel="stylesheet" href="//cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        background-color: #252526;
        color: #abb2bf;
      }
      .container {
        max-width: 90%;
        margin: 2rem auto;
        padding: 1rem;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      .header h1 {
        margin: 0;
        font-size: 1.5rem;
      }
      .btn {
        padding: 8px 16px;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        text-decoration: none;
        transition: background-color 0.3s ease;
      }
      .back-btn {
        background-color: #0e639c;
      }
      .back-btn:hover {
        background-color: #4fa8c9;
      }
      .copy-btn {
        background-color: #4CAF50;
      }
      .copy-btn:hover {
        background-color: #45a049;
      }
      .editor {
        display: flex;
        border: 1px solid #444;
        border-radius: 4px;
        overflow: hidden;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
      }
      .line-numbers {
        background-color: #2c313c;
        padding: 10px;
        text-align: right;
        color: #858585;
        user-select: none;
        font-size: 14px;
        line-height: 1.5;
        white-space: pre;
      }
      .code-container {
        flex: 1;
        background-color: #282c34;
        padding: 10px;
        overflow: auto;
      }
      pre {
        margin: 0;
      }
      code {
        font-size: 14px;
        line-height: 1.5;
        white-space: pre;
      }
      </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Paste: ${id}</h1>
        <div>
          <a class="btn back-btn" href="/">Back</a>
          <button class="btn copy-btn" onclick="copyToClipboard()">Copy</button>
        </div>
      </div>
      <div class="editor">
        <div class="line-numbers" id="line-numbers"></div>
        <div class="code-container" id="code-container">
          <pre><code id="code-block" class="plaintext">${escapeHtml(content)}</code></pre>
        </div>
      </div>
    </div>

    <script src="//cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
    <script>
      hljs.highlightAll();

      function copyToClipboard() {
        const code = document.getElementById('code-block').innerText;
        navigator.clipboard.writeText(code).then(function() {
          alert('Teks berhasil disalin!');
        }, function(err) {
            alert('Gagal menyalin teks: ' + err);
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
  const pasteUrl = `${req.protocol}://${req.get('host')}/${id}`;
  res.json({ url: pasteUrl, id: id });
});

// Jalankan HTTP server
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`HTTP server berjalan di port ${PORT}`);
});

// ---
// TCP Server untuk menerima upload via terminal
net.createServer((socket) => {
  let dataBuffer = '';

  socket.on('data', (chunk) => {
    dataBuffer += chunk.toString();
  });

  socket.on('end', () => {
    if (dataBuffer.trim()) {
      const id = crypto.randomBytes(3).toString('hex');
      pastes[id] = { content: dataBuffer, createdAt: new Date() };
      scheduleExpiration(id);
      const pasteUrl = `https://paste.orionos.vercel.app:${PORT}/${id}`; // Sesuaikan jika perlu
      socket.write(`Paste tersedia di: ${pasteUrl}\n`);
    }
    socket.end();
  });

  socket.on('error', (err) => {
    console.error('Error pada socket:', err);
  });
}).listen(TCP_PORT, () => {
  console.log(`TCP server berjalan di port ${TCP_PORT}`);
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
