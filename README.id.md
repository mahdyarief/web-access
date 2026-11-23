# web-access-mcp

<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

[English](README.md) · [Changelog](CHANGELOG.md) · Lisensi MIT · [![test](https://github.com/mahdyarief/web-access-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/mahdyarief/web-access-mcp/actions/workflows/test.yml)

Server [MCP](https://modelcontextprotocol.io) lokal tanpa dependensi, dikemas sebagai plugin Claude Code, yang memberi agen AI akses web:

- **Pencarian web** lewat [Exa](https://exa.ai) dan [Tavily](https://tavily.com). Bisa otomatis pindah ke provider lain saat gagal, atau menggabungkan hasil keduanya dengan *rank fusion*. Mendukung filter domain, waktu, dan kategori, jawaban AI, serta snippet ringkas.
- **Rotasi API key** untuk kedua provider. Key yang kena rate limit atau kuotanya habis diistirahatkan sementara.
- **Baca web**: halaman diambil langsung dan dibersihkan, halaman panjang bisa dibaca per bagian (`offset`), Tavily Extract jadi cadangan untuk PDF dan halaman JavaScript, dan Tavily Map/Crawl untuk membaca satu situs.
- **Aman secara default**: alamat jaringan internal/privat ditolak, ukuran unduhan dibatasi, tanpa telemetri.
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
- *"Halaman apa saja yang ada di docs.tavily.com soal API?"*: `web_map`
- *"Baca semua halaman API reference situs dokumentasi ini"*: `web_crawl` dengan `selectPaths`
- *"Cari repo MCP server populer yang ditulis dengan TypeScript"*: `github_search`
- *"Riset Bun vs Deno, beri jawaban singkat dan sumbernya"*: `web_search` dengan `provider: "both"` dan `includeAnswer: true`

Untuk cek konfigurasi, jalankan `/web-access:setup` atau minta *"jalankan web_access_status"*.

## Daftar tool

| Tool | Fungsi | Butuh key? |
|---|---|---|
| `web_search` | Pencarian web: `query`, `numResults` (1–10), `site`, `recency`, `category`, `provider`, `includeAnswer`, `maxCharsPerResult`, `fresh` | Tidak |
| `web_search_exa` | Pencarian **selalu** lewat Exa: `category`, `type` (auto/lite/deep) | Tidak (filter resmi butuh key Exa) |
| `web_search_tavily` | Pencarian Tavily: `topic` (general/news/finance), `searchDepth`, `includeAnswer`, `numResults` (1–20) | **Tavily** |
| `web_get_contents` | Isi halaman dari satu URL: `maxChars` (500–50000), `offset` untuk lanjut membaca | Tidak (PDF butuh Tavily) |
| `web_extract_tavily` | Ekstrak hingga 20 URL sekaligus | **Tavily** |
| `web_map` | Daftar URL sebuah situs (tanpa isi): `limit`, `maxDepth`, `selectPaths`, `excludePaths`, `instructions` | **Tavily** |
| `web_crawl` | Crawl situs dan ambil isi banyak halaman sekaligus: `limit` (1–50), `maxCharsPerPage` | **Tavily** |
| `web_access_status` | Status key (disamarkan), masa istirahat, **sisa kredit Tavily**, biaya Exa sesi ini, cache | Tidak |
| `github_search` | Cari repo, issue, kode, commit, topik di GitHub | Tidak (cari kode butuh `gh auth login`) |

Semua tool pencarian, ekstraksi, map, dan crawl menerima `fresh: true` untuk melewati cache.

- **`category`** (Exa): `news`, `publication` (paper/artikel), `company`, `personal site` (blog), `financial report`, `people`. Saat fallback ke Tavily, `news` dan `financial report` dipetakan ke topic `news` dan `finance`.
- **`includeAnswer`**: menambahkan jawaban AI dari Tavily dan/atau Exa `/answer` (masing-masing butuh key). Di mode `both`, kedua jawaban ditampilkan supaya bisa dicek silang.
- **`maxCharsPerResult`**: panjang snippet per hasil (default 1200, 100–10000).

**Exa dengan key vs tanpa key:** dengan key, request lewat REST API `api.exa.ai`, sehingga filter domain/tanggal/kategori resmi, `type`, `/answer`, dan biaya per request tersedia. Tanpa key, request lewat endpoint MCP Exa yang anonim, dan filter hanya diselipkan ke teks query.

## Mode pencarian (`web_search`)

| Mode | Perilaku | Cocok untuk |
|---|---|---|
| `auto` | Exa dulu, Tavily kalau Exa gagal. Kalau Exa **tanpa key** dan query memakai `site`/`recency`, Tavily dipakai lebih dulu karena punya filter resmi. | Sehari-hari |
| `exa` | Hanya Exa. | Hemat kredit Tavily |
| `tavily` | Tavily, Exa kalau Tavily gagal. Tanpa key Tavily, langsung pakai Exa dan diberi catatan. | Berita, kejadian terbaru |
| `both` | Exa dan Tavily jalan paralel, lalu digabung dengan **Reciprocal Rank Fusion**. URL yang sama hanya tampil sekali. Hasil yang ditemukan keduanya (`via exa + tavily`) ditaruh paling atas, sisanya diselang-seling adil berdasarkan peringkat. | Riset, cek silang |

**Ambil isi halaman:** diambil langsung dulu (gratis, maksimal 5 MB, alamat internal ditolak termasuk di setiap redirect). Tavily Extract hanya dipakai kalau pengambilan langsung gagal, kalau URL-nya PDF, atau kalau halamannya hampir kosong (biasanya dirender JavaScript). URL internal tidak pernah diteruskan ke Tavily. Dokumen di-cache utuh, jadi membaca bagian berikutnya dengan `offset` tidak mengunduh ulang.

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
  "tavily": { "timeoutMs": 45000, "keys": ["tvly-..."] },
  "fetch":  { "allowPrivateNetwork": false, "maxBytes": 5242880 }
}
```

| Setting | Default | Arti |
|---|---|---|
| `provider` | `auto` | Mode default `web_search`. |
| `cacheTtlSeconds` | `600` | Masa simpan cache. `0` mematikan cache. |
| `exa.keylessFallback` | `true` | Kalau semua key Exa ditolak, dicoba sekali lagi tanpa key. |
| `*.timeoutMs` | `45000` | Batas waktu total satu request, untuk semua key sekaligus. |
| `fetch.allowPrivateNetwork` | `false` | Izinkan `web_get_contents` membaca localhost/jaringan privat (misalnya dokumentasi lokal). |
| `fetch.maxBytes` | `5242880` | Batas ukuran unduhan langsung (5 MB). |

File ini dibaca ulang otomatis setiap kali berubah, jadi tidak perlu restart. Contoh lengkapnya ada di [`web-access.example.json`](web-access.example.json).

**File status:** masa istirahat key disimpan di `web-access-state.json`, **di folder yang sama dengan file config** (default `~/.openclaude/web-access-state.json`). Dengan begitu tetap berlaku setelah restart dan dipakai bersama oleh beberapa sesi. Isinya hanya sidik jari (SHA-256) key, **bukan key-nya**. File ini biasa, tidak terikat client MCP tertentu. Pindahkan dengan `WEB_ACCESS_STATE_FILE=/path/file.json`, atau `WEB_ACCESS_STATE_FILE=off` untuk menyimpan di memori saja.

## Rotasi key dan masa istirahat

Setiap request mulai dari key berikutnya (round-robin). Key yang ditolak langsung diganti, lalu diistirahatkan:

| Status | Arti | Diistirahatkan |
|---|---|---|
| 429 | Rate limit | 1 menit, atau sesuai header `Retry-After` (maks. 1 jam) |
| 402 / 432 / 433 | Kredit atau kuota habis | 24 jam |
| 401 | Key tidak valid | 6 jam |

**403 tidak membuat key diistirahatkan**, karena artinya "URL tidak didukung" atau konten dilarang, bukan masalah key.

Error jaringan dan 5xx juga membuat request mencoba key berikutnya. Error lain (misalnya 400) langsung gagal supaya key tidak terbuang. Semua percobaan berbagi satu batas waktu, jadi request tidak menggantung sampai bermenit-menit.

## Biaya kredit

- Mode `auto`/`exa`: 1 request Exa (gratis kalau tanpa key). Tavily hanya terpakai saat Exa gagal.
- Mode `both`: 1 request Exa ditambah 1 pencarian Tavily.
- `includeAnswer`: jawaban Tavily sudah termasuk dalam pencarian. Exa `/answer` menambah 1 request (kalau ada key Exa).
- `web_search_tavily`: `basic` 1 kredit, `advanced` 2 kredit.
- `web_extract_tavily`: 1 kredit per 5 URL (basic). `web_map`: 1 kredit per 10 halaman. `web_crawl`: map ditambah extract (10 halaman basic ≈ 3 kredit).
- Angka bisa berubah, cek [dokumentasi kredit Tavily](https://docs.tavily.com/documentation/api-credits). Pemakaian sebenarnya terlihat di `web_access_status`.
- Pencarian yang diulang dan sudah ada di cache tidak memakai kredit.

## Privasi dan keamanan

- Query pencarian dikirim ke Exa dan/atau Tavily. Halaman yang dibaca diambil **langsung dari komputer Anda**, atau lewat Tavily Extract kalau cadangannya dipakai.
- **Tidak ada telemetri.** Satu-satunya file yang ditulis adalah file status masa istirahat, yang berisi sidik jari, bukan key. Cache hanya di memori.
- **Proteksi SSRF:** `web_get_contents` menolak `localhost`, rentang privat dan link-local (termasuk alamat metadata cloud `169.254.169.254`), host `.local`/`.internal`, dan nama host yang resolve ke alamat tersebut, dicek ulang di setiap redirect. Ini mengurangi risiko, tapi bukan sandbox jaringan penuh.
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
| `refusing to fetch internal address …` | Proteksi SSRF. Untuk membaca dokumentasi lokal/intranet, set `"fetch": {"allowPrivateNetwork": true}`. |
| `Tavily error 403` di map/crawl | URL itu tidak didukung Tavily. Pakai `web_get_contents` per halaman. |
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

File config dan file status Anda (`~/.openclaude/web-access*.json`) tidak ikut dihapus.

## Pengembangan

```bash
npm test                    # semua respons API dipalsukan: tidak butuh internet maupun key
claude plugin validate .
```

Untuk merilis versi baru: naikkan `version` di `.claude-plugin/plugin.json` **dan** `package.json`, tambahkan catatan di `CHANGELOG.md`, jalankan tes, lalu commit dan push. Struktur file proyek dijelaskan di [README bahasa Inggris](README.md#project-structure).

## Lisensi

[MIT](LICENSE) © mahdyarief
