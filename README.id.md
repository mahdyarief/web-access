# web-access-mcp

<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

[English](README.md) · [Changelog](CHANGELOG.md) · Lisensi MIT

Server [MCP](https://modelcontextprotocol.io) lokal tanpa dependensi, dikemas sebagai plugin Claude Code, yang memberi agen AI akses web:

- **Pencarian web** lewat [Exa](https://exa.ai) dan [Tavily](https://tavily.com). Bisa otomatis pindah ke provider lain saat gagal, atau menggabungkan hasil keduanya.
- **Rotasi API key** untuk kedua provider. Key yang kena rate limit atau kuotanya habis diistirahatkan sementara.
- **Ambil isi halaman**: diambil langsung lalu dibersihkan dari menu dan iklan, dengan Tavily Extract sebagai cadangan untuk PDF dan halaman yang dirender JavaScript.
- **Pencarian GitHub**: repo, kode, issue, commit, topik.

Langsung jalan tanpa setup apa pun, karena Exa bisa dipakai **tanpa key**. Tavily opsional, dan menambahkan pencarian berita/finansial, jawaban AI, filter waktu dan domain yang resmi, serta ekstraksi PDF.

> Dokumen ini ringkasan. Referensi lengkap semua parameter ada di [README bahasa Inggris](README.md#tools-reference).

## Kebutuhan

- **Node.js 18.17 atau lebih baru** di `PATH`. Cek dengan `node -v`. Tidak perlu `npm install`.
- **Claude Code**, atau client MCP lain yang mendukung server stdio.
- Opsional: key [Tavily](https://app.tavily.com), key [Exa](https://dashboard.exa.ai), dan [GitHub CLI](https://cli.github.com) (`gh auth login`) untuk pencarian kode GitHub.

Bisa dipakai di Windows, macOS, dan Linux.

## Instalasi

### Plugin Claude Code (disarankan)

```
/plugin marketplace add mahdyarief/web-access-mcp
/plugin install web-access@mahdyarief
```

Di Claude Code 2.1.275 ke atas, cukup satu perintah:

```
/plugin install web-access --marketplace mahdyarief/web-access-mcp
```

Saat instalasi, Claude Code menanyakan opsi berikut. **Semuanya opsional**:

| Opsi | Keterangan |
|---|---|
| **Tavily API keys** | Key `tvly-...`, pisahkan dengan koma. Key dirotasi otomatis. |
| **Exa API keys** | Pisahkan dengan koma. Kosongkan untuk memakai Exa tanpa key. |
| **Default search provider** | `auto` (default), `exa`, `tavily`, atau `both`. |

Key disimpan di penyimpanan kredensial OS, bukan di `settings.json`, dan tidak pernah lewat chat. Untuk mengubahnya, jalankan `/plugin configure web-access@mahdyarief` lalu restart Claude Code.

Lewat terminal:

```bash
claude plugin marketplace add mahdyarief/web-access-mcp
claude plugin install web-access@mahdyarief
echo '{"tavily_api_keys":"tvly-aaa,tvly-bbb"}' | claude plugin configure web-access@mahdyarief --values-stdin
```

Plugin ini berisi:
- **MCP server** `web-access` dengan semua tool di bawah
- skill **`web-research`**: panduan agar Claude memilih tool dan mode yang tepat
- skill **`/web-access:setup`**: mengatur key, mengecek status, dan mendiagnosis masalah

### Client MCP lain

```json
{
  "mcpServers": {
    "web-access": {
      "command": "node",
      "args": ["/path/lengkap/web-access-mcp/server.js"],
      "env": { "TAVILY_API_KEYS": "tvly-aaa,tvly-bbb" }
    }
  }
}
```

## Mulai cepat

Setelah terpasang, tinggal minta ke Claude:

- *"Apa yang baru di rilis Node.js terakhir?"*: `web_search` dengan `recency`
- *"Baca https://example.com/docs lalu ringkas bagian autentikasinya"*: `web_get_contents`
- *"Cari repo MCP server populer yang ditulis dengan TypeScript"*: `github_search`
- *"Riset kelebihan dan kekurangan Bun vs Deno, sertakan sumber"*: `web_search` dengan `provider: "both"`

Untuk cek konfigurasi, jalankan `/web-access:setup` atau minta *"jalankan web_access_status"*.

## Daftar tool

| Tool | Fungsi | Butuh key? |
|---|---|---|
| `web_search` | Pencarian web: `query`, `numResults` (1–10), `site`, `recency`, `provider`, `fresh` | Tidak |
| `web_search_exa` | Pencarian **selalu** lewat Exa: `type` (auto/keyword/neural) | Tidak |
| `web_search_tavily` | Pencarian Tavily: `topic` (general/news/finance), `searchDepth`, `includeAnswer`, `numResults` (1–20) | **Tavily** |
| `web_get_contents` | Isi halaman dari satu URL: `maxChars` (500–50000) | Tidak (PDF butuh Tavily) |
| `web_extract_tavily` | Ekstrak hingga 20 URL sekaligus | **Tavily** |
| `web_access_status` | Status key (disamarkan), masa istirahat key, cache | Tidak |
| `github_search` | Cari repo, issue, kode, commit, topik di GitHub | Tidak (cari kode butuh `gh auth login`) |

Semua tool pencarian dan ekstraksi menerima `fresh: true` untuk melewati cache.

## Mode pencarian (`web_search`)

| Mode | Perilaku | Cocok untuk |
|---|---|---|
| `auto` | Exa dulu, Tavily kalau Exa gagal. Kalau ada `site`/`recency` dan key Tavily tersedia, Tavily dipakai **lebih dulu**. | Sehari-hari |
| `exa` | Hanya Exa. | Hemat kredit Tavily |
| `tavily` | Tavily, Exa kalau Tavily gagal. Tanpa key Tavily, langsung pakai Exa dan diberi catatan. | Berita, kejadian terbaru |
| `both` | Exa dan Tavily jalan paralel. URL yang sama hanya ditampilkan sekali, dan hasil yang ditemukan keduanya (`via exa + tavily`) ditaruh paling atas. | Riset, cek silang |

**Ambil isi halaman:** diambil langsung dulu (gratis). Tavily Extract hanya dipakai kalau pengambilan langsung gagal, kalau URL-nya PDF, atau kalau halamannya hampir kosong (biasanya dirender JavaScript).

**Cache:** hasil yang sukses disimpan di memori selama `cacheTtlSeconds` (default 600 detik). Error tidak pernah di-cache.

## Konfigurasi

Key diambil dari sumber pertama yang berisi key, terpisah untuk tiap provider:

1. **Env / pengaturan plugin**: `TAVILY_API_KEYS` dan `EXA_API_KEYS` (dipisah koma).
2. **File config**: `~/.openclaude/web-access.json`. Lokasinya bisa diganti lewat `WEB_ACCESS_CONFIG`.
3. **File lama**: `~/.openclaude/exa_keys.json` dan `~/.openclaude/tavily_keys.json`.

```json
{
  "provider": "auto",
  "cacheTtlSeconds": 600,
  "exa":    { "keylessFallback": true, "timeoutMs": 45000, "keys": [] },
  "tavily": { "timeoutMs": 45000, "keys": ["tvly-..."] }
}
```

| Setting | Default | Arti |
|---|---|---|
| `provider` | `auto` | Mode default `web_search`. |
| `cacheTtlSeconds` | `600` | Masa simpan cache. `0` mematikan cache. |
| `exa.keylessFallback` | `true` | Kalau semua key Exa ditolak, dicoba sekali lagi tanpa key. |
| `*.timeoutMs` | `45000` | Batas waktu total satu request, untuk semua key sekaligus. |

File ini dibaca ulang otomatis setiap kali berubah, jadi tidak perlu restart. Contoh lengkapnya ada di [`web-access.example.json`](web-access.example.json).

## Rotasi key dan masa istirahat

Setiap request mulai dari key berikutnya (round-robin). Key yang ditolak langsung diganti, lalu diistirahatkan:

| Status | Arti | Diistirahatkan |
|---|---|---|
| 429 | Rate limit | 1 menit |
| 402 / 432 / 433 | Kredit atau kuota habis | 24 jam |
| 401 / 403 | Key tidak valid | 6 jam |

Error jaringan dan 5xx juga membuat request mencoba key berikutnya. Error lain (misalnya 400) langsung gagal supaya key tidak terbuang. Semua percobaan berbagi satu batas waktu, jadi request tidak menggantung sampai bermenit-menit.

## Biaya kredit

- Mode `auto`/`exa`: 1 request Exa (gratis kalau tanpa key). Tavily hanya terpakai saat Exa gagal.
- Mode `both`: 1 request Exa ditambah 1 pencarian Tavily.
- `web_search_tavily`: `basic` sekitar 1 kredit, `advanced` sekitar 2 kredit. Angkanya bisa berubah, cek [dokumentasi Tavily](https://docs.tavily.com).
- Pencarian yang diulang dan sudah ada di cache tidak memakai kredit.

## Privasi dan keamanan

- Query pencarian dikirim ke Exa dan/atau Tavily. Halaman yang dibaca diambil **langsung dari komputer Anda**, atau lewat Tavily Extract kalau cadangannya dipakai.
- **Tidak ada telemetri.** Tidak ada yang disimpan ke disk. Cache dan masa istirahat key hanya ada di memori.
- Key tidak pernah ditulis ke log. `web_access_status` hanya menampilkan key yang disamarkan.
- File config berupa teks biasa. Jangan pernah di-commit. Kalau key bocor (ke chat, log, atau commit), ganti (rotate) di dashboard provider.

## Troubleshooting

| Gejala | Penyebab dan solusi |
|---|---|
| `web-access` tidak muncul atau gagal di `/mcp` | Node.js belum terpasang atau versinya di bawah 18.17. Cek `node -v`, lalu restart Claude Code. |
| `No Tavily API keys configured` | Tavily opsional. Pakai `web_search` (Exa tanpa key), atau tambahkan key lewat `/plugin configure web-access@mahdyarief`. |
| Key sudah diisi tapi status masih kosong | Restart Claude Code setelah `/plugin configure`. Pastikan juga key Tavily diawali `tvly-`. |
| `All Tavily keys are cooling down` | Semua key kena limit. Cek sisa waktunya di `web_access_status`, sementara pakai `provider: "exa"`, atau tambah key. |
| `Exa error 429` tanpa key | Batas Exa untuk pemakaian tanpa key tercapai. Tambahkan key Exa atau Tavily. |
| `request timed out` | Jaringan atau provider lambat. Ulangi, atau naikkan `timeoutMs`. |
| PDF tidak bisa dibaca | Tambahkan key Tavily. |
| `GitHub API requires authentication` | Pencarian kode butuh login. Jalankan `gh auth login` atau set `GITHUB_TOKEN`. |
| Hasil terasa usang | Pakai `fresh: true`, atau set `cacheTtlSeconds: 0`. |

## Update dan uninstall

```
/plugin marketplace update mahdyarief
/plugin update web-access@mahdyarief
```

Restart Claude Code setelah update. Untuk menghapus plugin:

```
/plugin uninstall web-access@mahdyarief
/plugin marketplace remove mahdyarief
```

File config Anda tidak ikut dihapus.

## Pengembangan

```bash
npm test                    # semua respons API dipalsukan: tidak butuh internet maupun key
claude plugin validate .
```

Untuk merilis versi baru: naikkan `version` di `.claude-plugin/plugin.json` **dan** `package.json`, tambahkan catatan di `CHANGELOG.md`, jalankan tes, lalu commit dan push. Struktur file proyek dijelaskan di [README bahasa Inggris](README.md#project-structure).

## Lisensi

[MIT](LICENSE) © mahdyarief
