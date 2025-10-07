$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

$PDFJS_VER = "3.11.174"
$TESS_VER  = "5.0.0"
$TESS_CORE_VER = "5.0.0"
$OPENCV_URL = "https://docs.opencv.org/4.x/opencv.js"

$PDF_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@$PDFJS_VER/build"
$TESS_BASE = "https://unpkg.com/tesseract.js@$TESS_VER/dist"
$TESS_CORE_BASE = "https://unpkg.com/tesseract.js-core@$TESS_CORE_VER"

Write-Host "Downloading vendor libraries..."

New-Item -ItemType Directory -Force -Path "vendor\pdfjs" | Out-Null
New-Item -ItemType Directory -Force -Path "vendor\tesseract\lang-data" | Out-Null
New-Item -ItemType Directory -Force -Path "vendor\opencv" | Out-Null

Invoke-WebRequest "$PDF_BASE/pdf.min.js"        -OutFile "vendor\pdfjs\pdf.min.js"
Invoke-WebRequest "$PDF_BASE/pdf.worker.min.js" -OutFile "vendor\pdfjs\pdf.worker.min.js"

Invoke-WebRequest "$TESS_BASE/tesseract.min.js" -OutFile "vendor\tesseract\tesseract.min.js"
Invoke-WebRequest "$TESS_BASE/worker.min.js"    -OutFile "vendor\tesseract\worker.min.js"

# core は別パッケージ
Invoke-WebRequest "$TESS_CORE_BASE/tesseract-core.wasm" -OutFile "vendor\tesseract\tesseract-core.wasm"

Invoke-WebRequest $OPENCV_URL -OutFile "vendor\opencv\opencv.js"

Write-Host "Done."
Write-Host "言語データ eng.traineddata（必要なら jpn.traineddata）を vendor\tesseract\lang-data に置いてください。"
