# Chinese nickname source

- Source: https://github.com/XadillaX/chinese-random-name
- Commit: `be80a1afe49e6a376626c803c4b1e31079be406d`
- Adopted: a curated subset of `dict/f_text.js` and the surname + given-name composition approach.
- Local adaptation: deterministic SHA-256 selection, original short nickname vocabulary, per-room collision handling. No native RNG dependency, external request, real profile scraping, or user-identification claim.
- The project dictionary's fortune-telling descriptions and unreviewed name characters are not included.

## MIT license

Copyright (c) 2019 Khaidi Chu

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
