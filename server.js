const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");

const app = express();
const PORT = 3120;
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Self-hosted PeerJS signaling server (no dependency on cloud broker)
const { ExpressPeerServer } = require('peer');
const server = http.createServer(app);
app.use('/peerjs', ExpressPeerServer(server, { debug: false, proxied: true }));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = file.originalname.replace(ext, "");
    cb(null, name + "_" + Date.now() + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOAD_DIR));

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

app.get("/api/models", (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(glb|gltf|fbx)$/i.test(f));
    res.json(files.map(f => ({ name: f, url: `/uploads/${f}` })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/models/:name", (req, res) => {
  const p = path.join(UPLOAD_DIR, req.params.name);
  if (fs.existsSync(p)) { fs.unlinkSync(p); res.json({ ok: true }); }
  else res.status(404).json({ error: "Not found" });
});

server.listen(PORT, () => console.log(`Game server + PeerJS signaling on http://localhost:${PORT}`));
