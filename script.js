// script.js : PDF/画像 → 棚矩形検出 + OCR（Tesseract.js v5） → CSV/JSON
(() => {
  const $ = (id)=>document.getElementById(id);
  const logEl=$("log"), canvas=$("canvas"), ctx=canvas.getContext("2d");
  const cvState=$("opencvState"), pdfState=$("pdfjsState"), tessState=$("tessState");

  let fileBlob=null, shelfRects=[], opencvReady=false, pdfjsReady=false;
  let tessWorker=null, tessReady=false;

  const log = (m)=>{ logEl.textContent += m+"\n"; logEl.scrollTop=logEl.scrollHeight; };

  // -------- OpenCV.js 初期化待ち --------
  const waitOpenCV = new Promise((resolve)=>{
    const ok=()=>{ opencvReady=true; cvState.textContent="OpenCV.js: OK"; cvState.classList.add("ok"); resolve(); };
    if (typeof cv !== "undefined" && cv.onRuntimeInitialized) cv.onRuntimeInitialized = ok;
    else {
      const iv=setInterval(()=>{ if (typeof cv!=="undefined" && cv.Mat){ clearInterval(iv); ok(); }},100);
    }
  });

  // -------- pdf.js 初期化待ち --------
  const waitPDFJS = new Promise((resolve)=>{
    const setOk=()=>{ pdfjsReady=true; pdfState.textContent="pdf.js: OK"; pdfState.classList.add("ok"); resolve(); };
    const lib=window['pdfjs-dist/build/pdf'];
    if (lib && lib.getDocument) setOk();
    else {
      const iv=setInterval(()=>{ const l=window['pdfjs-dist/build/pdf']; if (l && l.getDocument){ clearInterval(iv); setOk(); } },100);
    }
  });

  // 言語コードを正規化（"eng（数字中心）" → "eng", "jpn, 日本語" → "jpn" など）
  function normalizeLang(value){
    const m = String(value || "").toLowerCase().match(/[a-z+]+/g);
    return m ? m.join("+") : "eng";
  }

  // -------- Tesseract.js v5 初期化 --------
  async function ensureTesseract(lang){
    if (tessWorker && tessReady) return;
    if (!window.Tesseract){ log("Tesseract.js が読み込まれていません。"); return; }

    try{
      const workerPath = "./vendor/tesseract/worker.min.js";
      const corePath   = "./vendor/tesseract/tesseract-core.wasm.js"; // ローダーJS
      const langPath   = "./vendor/tesseract/lang-data/";             // 末尾 / 必須
      log(`Init Tesseract: worker=${workerPath}, core=${corePath}, langPath=${langPath}`);

      // logger は渡さない（環境により DataCloneError を誘発）
      tessWorker = await Tesseract.createWorker({ workerPath, corePath, langPath });

      await tessWorker.loadLanguage(lang);
      await tessWorker.initialize(lang);

      tessReady = true;
      tessState.textContent = "Tesseract: OK";
      tessState.classList.add("ok");
      log("Tesseract initialized.");
    }catch(err){
      tessReady = false;
      tessState.textContent = "Tesseract: 初期化失敗";
      log("Tesseract init error: " + (err?.message || String(err)));
      throw err;
    }
  }

  // -------- UI --------
  $("fileInput").addEventListener("change",(e)=>{
    fileBlob = e.target.files?.[0] ?? null;
    log(`選択: ${fileBlob ? fileBlob.name : "(なし)"}`);
  });

  $("runBtn").addEventListener("click", async ()=>{
    if (!fileBlob){ alert("ファイルを選択してください"); return; }

    const useOCR = $("useOCR").checked;
    const lang = normalizeLang($("ocrLang").value);     // ★ 正規化してから使用
    const numericOnly = $("ocrNumeric").checked;
    const scale = Math.max(1, parseFloat($("ocrScale").value)||2);

    const normW=parseInt($("normW").value)||1240, normH=parseInt($("normH").value)||1754;
    const dpi=parseInt($("dpi").value)||300;
    const minArea=parseFloat($("minArea").value)||800;
    const minRect=parseFloat($("minRect").value)||0.7;
    const maxAsp=parseFloat($("maxAsp").value)||25;

    try{
      await waitOpenCV; await waitPDFJS;
      if (useOCR){ await ensureTesseract(lang); }

      shelfRects=[];
      ctx.clearRect(0,0,canvas.width,canvas.height);

      const isPdf = fileBlob.type === "application/pdf" || /\.pdf$/i.test(fileBlob.name);
      if (isPdf){
        const pages = await renderPdfToImages(fileBlob, dpi);
        log(`PDFページ数: ${pages.length}`);
        if (pages.length) drawPreview(pages[0].img);
        for (const page of pages){
          const rects = detectRects(page.img, page.pageIndex, normW, normH,
            {minArea, minRectangularity:minRect, maxAspect:maxAsp});
          if (useOCR) await runOCRForRects(rects, page.img, {numericOnly, scale});
          shelfRects.push(...rects);
        }
      }else{
        const img = await blobToImage(fileBlob);
        drawPreview(img);
        const rects = detectRects(img, 0, normW, normH,
          {minArea, minRectangularity:minRect, maxAspect:maxAsp});
        if (useOCR) await runOCRForRects(rects, img, {numericOnly, scale});
        shelfRects.push(...rects);
      }

      overlayRects(shelfRects.filter(r=>r.page===0), true);
      log(`検出: ${shelfRects.length} 個` + (useOCR? "（OCR済）":""));
    }catch(err){
      console.error(err);
      alert("実行中にエラーが発生しました。ログを確認してください。");
    }
  });

  $("expCsvBtn").addEventListener("click", ()=>{
    if (!shelfRects.length){ alert("先に実行してください"); return; }
    const rows=[["shelf_id","page","box_img","bbox_img","box_norm","bbox_norm","angle","area","score","img_w","img_h","numbers","text"]];
    shelfRects.forEach((r,i)=>{
      rows.push([
        i+1,r.page,JSON.stringify(r.box_img),JSON.stringify(r.bbox_img),JSON.stringify(r.box_norm),JSON.stringify(r.bbox_norm),
        r.angle,r.area,r.score,r.img_w,r.img_h, JSON.stringify(r.numbers||[]), JSON.stringify(r.text||"")
      ]);
    });
    const csv = rows.map(r=>r.join(",")).join("\n");
    downloadText("shelves_ocr.csv", csv);
  });

  $("expJsonBtn").addEventListener("click", ()=>{
    if (!shelfRects.length){ alert("先に実行してください"); return; }
    downloadText("shelves_ocr.json", JSON.stringify(shelfRects,null,2));
  });

  // -------- 共通ユーティリティ --------
  function downloadText(name,text){
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([text],{type:"text/plain"}));
    a.download=name; a.click(); URL.revokeObjectURL(a.href);
  }
  function blobToImage(blob){
    return new Promise((resolve)=>{
      const fr=new FileReader();
      fr.onload=()=>{ const img=new Image(); img.onload=()=>resolve(img); img.src=fr.result; };
      fr.readAsDataURL(blob);
    });
  }

  // -------- PDF→画像 --------
  async function renderPdfToImages(blob,dpi){
    const pdfjsLib = window['pdfjs-dist/build/pdf']; const arrBuf=await blob.arrayBuffer();
    const loading=pdfjsLib.getDocument({data:arrBuf}); const pdf=await loading.promise;
    const scale=dpi/72; const pages=[];
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const viewport=page.getViewport({scale});
      const off=document.createElement("canvas"); off.width=viewport.width; off.height=viewport.height;
      const c2d=off.getContext("2d",{willReadFrequently:true});
      await page.render({canvasContext:c2d, viewport}).promise;
      const img=await new Promise(res=> off.toBlob(b=>{
        const fr=new FileReader(); fr.onload=()=>{ const im=new Image(); im.onload=()=>res(im); im.src=fr.result; };
        fr.readAsDataURL(b);
      },"image/png"));
      pages.push({pageIndex:i-1, img});
    }
    return pages;
  }

  // -------- 棚の長方形検出（OpenCV.js） --------
  function detectRects(img, pageIndex, normW, normH, opts){
    const {minArea=800, minRectangularity=0.7, maxAspect=25} = opts||{};
    const w=img.width, h=img.height;

    const src=cv.imread(img), gray=new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const bin=new cv.Mat(); cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 35, 10);
    const kernel=cv.Mat.ones(3,3, cv.CV_8U), mor=new cv.Mat(); cv.morphologyEx(bin, mor, cv.MORPH_CLOSE, kernel);
    const edges=new cv.Mat(); cv.Canny(mor, edges, 60, 180);

    const contours=new cv.MatVector(), hierarchy=new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const res=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i); if (cnt.rows<4){ cnt.delete(); continue; }
      const rect=cv.minAreaRect(cnt);
      const rw=rect.size.width, rh=rect.size.height;
      if (rw<=1 || rh<=1){ cnt.delete(); continue; }

      const area=rw*rh; if (area<minArea){ cnt.delete(); continue; }
      const asp=Math.max(rw,rh)/Math.max(1,Math.min(rw,rh)); if (asp>maxAspect){ cnt.delete(); continue; }

      const box=cv.RotatedRect.points(rect);
      const poly=box.map(p=>[Math.round(p.x), Math.round(p.y)]);
      const contourArea=cv.contourArea(cnt,false);
      const rectangularity=contourArea/(area+1e-6);
      if (rectangularity<minRectangularity){ cnt.delete(); continue; }

      const xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
      const xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);

      const boxNorm=poly.map(([x,y])=>[
        Math.round(x/(w-1)*(normW-1)),
        Math.round(y/(h-1)*(normH-1))
      ]);
      const bboxNorm=[
        Math.round(xmin/(w-1)*(normW-1)),
        Math.round(ymin/(h-1)*(normH-1)),
        Math.round(xmax/(w-1)*(normW-1)),
        Math.round(ymax/(h-1)*(normH-1))
      ];
      const score = 0.5*(rectangularity) + 0.5*(1 - Math.min(asp/ maxAspect, 1));

      res.push({ page:pageIndex, box_img:poly, bbox_img:[xmin,ymin,xmax,ymax],
                 box_norm:boxNorm, bbox_norm:bboxNorm, angle:rect.angle,
                 area, score, img_w:w, img_h:h });
      cnt.delete();
    }

    src.delete(); gray.delete(); bin.delete(); kernel.delete(); mor.delete();
    edges.delete(); contours.delete(); hierarchy.delete();

    return nms(res, 0.30);
  }

  // -------- NMS --------
  function nms(items, iouThresh){
    if (!items.length) return [];
    const boxes=items.map(r=>r.bbox_img), scores=items.map(r=>r.score);
    const idxs=scores.map((s,i)=>[s,i]).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
    const keep=[];
    while(idxs.length){
      const i=idxs.shift(); keep.push(i);
      const rest=[];
      for (const j of idxs){ if (iouOf(boxes[i], boxes[j])<iouThresh) rest.push(j); }
      idxs.splice(0, idxs.length, ...rest);
    }
    return keep.map(i=>items[i]);
  }
  function iouOf(a,b){
    const [ax1,ay1,ax2,ay2]=a,[bx1,by1,bx2,by2]=b;
    const xx1=Math.max(ax1,bx1), yy1=Math.max(ay1,by1), xx2=Math.min(ax2,bx2), yy2=Math.min(ay2,by2);
    const w=Math.max(0,xx2-xx1+1), h=Math.max(0,yy2-yy1+1); const inter=w*h;
    const areaA=(ax2-ax1+1)*(ay2-ay1+1), areaB=(bx2-bx1+1)*(by2-by1+1);
    return inter/Math.max(1e-6, areaA+areaB-inter);
  }

  // -------- OCR（矩形ごと） --------
  async function runOCRForRects(rects, img, opts){
    if (!tessWorker || !tessReady){ log("Tesseractワーカー未初期化"); return; }
    const {numericOnly=true, scale=2} = opts||{};
    const off=document.createElement("canvas"), octx=off.getContext("2d");

    for (const r of rects){
      const [x1,y1,x2,y2] = r.bbox_img;
      const w = Math.max(1, x2-x1), h=Math.max(1, y2-y1);
      off.width = Math.max(1, Math.floor(w*scale));
      off.height= Math.max(1, Math.floor(h*scale));
      octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
      octx.clearRect(0,0,off.width, off.height);
      octx.drawImage(img, x1, y1, w, h, 0, 0, off.width, off.height);

      await tessWorker.setParameters(
        numericOnly ? { tessedit_char_whitelist: "0123456789０１２３４５６７８９" } : {}
      );
      const { data:{ text } } = await tessWorker.recognize(off);
      const nums = extractNumbers(text);
      r.text = text.trim();
      r.numbers = Array.from(new Set(nums));
    }
  }
  function extractNumbers(s){
    const t = s.replace(/[０-９]/g, (c)=> String.fromCharCode(c.charCodeAt(0)-0xFEE0));
    const m = t.match(/\d+/g);
    return m ? m : [];
  }
})();
