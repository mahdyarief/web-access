# web-access-mcp

<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

[English](README.md) · Lisensi MIT

Server [MCP](https://modelcontextprotocol.io) lokal tanpa dependensi yang memberi agen AI akses web:

- **Pencarian web** lewat [Exa](https://exa.ai) dan [Tavily](https://tavily.com). Bisa otomatis pindah ke provider lain saat gagal, atau menggabungkan hasil keduanya.
- **Rotasi API key** untuk kedua provider. Key yang kena rate limit atau kuotanya habis diistirahatkan sementara.
- **Ambil isi halaman**: diambil langsung lalu dibersihkan dari menu dan iklan, dengan Tavily Extract sebagai cadangan untuk PDF dan halaman yang dirender JavaScript.
- **Pencarian GitHub**: repo, kode, issue, commit, topik.

Cukup Node.js 18.17+. Langsung jalan tanpa setup apa pun, karena Exa bisa dipakai **tanpa key**.

## Instalasi sebagai plugin Claude Code

```
/plugin marketplace add mahdyarief/web-access-mcp
/plugin install web-access@mahdyarief
```

Di Claude Code 2.1.275 ke atas, cukup satu perintah:

```
/plugin install web-access --marketplace mahdyarief/web-access-mcp
```

Saat instalasi, Claude Code menanyakan opsi berikut. Semuanya opsional:

| Opsi | Keterangan |
|---|---|
| **Tavily API keys** | Key `tvly-...`, pisahkan dengan koma. Key dirotasi otomatis. Daftar gratis di [app.tavily.com](https://app.tavily.com). |
| **Exa API keys** | Pisahkan dengan koma. Kosongkan untuk memakai Exa tanpa key. |
| **Default search provider** | `auto` (default), `exa`, `tavily`, atau `both`. |

Key disimpan di penyimpanan kredensial OS, bukan di `settings.json`. Untuk mengubahnya, jalankan `/plugin configure web-access@mahdyarief` lalu restart Claude Code. `/web-access:setup` memandu pengecekan konfigurasi.

Plugin ini berisi:
- server MCP dengan tools `web_search`, `web_search_tavily`, `web_get_contents`, `web_extract_tavily`, `web_access_status` dan `github_search`
- skill **`web-research`**: panduan agar Claude memilih tool yang tepat
- skill **`/web-access:setup`**: mengatur key dan mendiagnosis masalah

## Mode pencarian (`web_search`)

| Mode | Perilaku |
|---|---|
| `auto` | Exa dulu, Tavily sebagai cadangan. Kalau ada `site`/`recency` dan key Tavily tersedia, Tavily dipakai **lebih dulu** karena mendukung filter itu secara resmi. |
| `exa` | Hanya Exa. |
| `tavily` | Tavily, dengan Exa sebagai cadangan. Tanpa key Tavily, langsung pakai Exa dan diberi catatan. |
| `both` | Exa dan Tavily jalan paralel. Hasilnya digabung, URL yang sama hanya ditampilkan sekali, dan hasil yang ditemukan keduanya ditaruh paling atas. Kredit kedua provider terpakai, jadi pakai saat riset saja. |

## Konfigurasi

Key diambil dari sumber pertama yang berisi key:

1. **Env / pengaturan plugin**: `TAVILY_API_KEYS` dan `EXA_API_KEYS` (dipisah koma).
2. **File config**: `~/.openclaude/web-access.json`. Lihat [`web-access.example.json`](web-access.example.json).
3. **File lama**: `~/.openclaude/exa_keys.json` dan `~/.openclaude/tavily_keys.json`.

Contoh file config:

```json
{
  "provider": "auto",
  "cacheTtlSeconds": 600,
  "exa":    { "keylessFallback": true, "timeoutMs": 45000, "keys": [] },
  "tavily": { "timeoutMs": 45000, "keys": ["tvly-..."] }
}
```

- `cacheTtlSeconds`: berapa lama hasil yang sama diambil dari memori. Isi `0` untuk mematikan cache.
- `exa.keylessFallback`: kalau semua key Exa ditolak, dicoba sekali lagi tanpa key.
- `timeoutMs`: batas waktu total satu request, untuk semua key sekaligus.
- File ini dibaca ulang otomatis setiap kali berubah, jadi tidak perlu restart.

## Rotasi key dan masa istirahat

| Status | Arti | Diistirahatkan |
|---|---|---|
| 429 | Rate limit | 1 menit |
| 402 / 432 / 433 | Kredit atau kuota habis | 24 jam |
| 401 / 403 | Key tidak valid | 6 jam |

Error jaringan dan 5xx membuat request mencoba key berikutnya. Error lain (misalnya 400) langsung gagal, supaya semua key tidak terbuang percuma. Status semua key bisa dilihat dengan `web_access_status`.

## Pengembangan

```bash
npm test   # semua respons API dipalsukan: tidak butuh internet maupun API key
```

## Lisensi

[MIT](LICENSE) © mahdyarief
