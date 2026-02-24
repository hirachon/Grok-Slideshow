// ==============================================================================
// 設定 (Configuration)
// ==============================================================================
// 【保存設定】
const SAVE_DIR_NAME = 'ai';

// 【フィルタリング設定】
const MIN_IMAGE_WIDTH = 1280;
const MIN_IMAGE_HEIGHT = 720;
const MIN_DATA_LENGTH = 80000;

// 【動作設定】
const SCROLL_TRIGGER_THRESHOLD = 5;
const SCAN_INTERVAL_MS = 2000;
// ==============================================================================

(() => {
    const imageIndexMap = new Map();
    const globalImageList = [];
    
    let currentIndex = 0;
    let isSlideshowActive = false;
    let isScanning = false;

    let overlay = null;
    let mainImage = null;
    let counter = null;
    let notification = null;

    function init() {
        createSlideshowUI();
        startObserving();
        document.addEventListener('keydown', handleKeydown);
        setInterval(() => requestScan(), SCAN_INTERVAL_MS);
    }

    function createSlideshowUI() {
        if (document.getElementById('grok-slideshow-overlay')) return;

        overlay = document.createElement('div');
        overlay.id = 'grok-slideshow-overlay';

        const closeBtn = document.createElement('div');
        closeBtn.id = 'grok-slideshow-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = closeSlideshow;

        mainImage = document.createElement('img');
        mainImage.id = 'grok-slideshow-image';

        const prevBtn = document.createElement('div');
        prevBtn.className = 'grok-slideshow-nav';
        prevBtn.id = 'grok-nav-prev';
        prevBtn.innerHTML = '&#10094;';
        prevBtn.onclick = (e) => { e.stopPropagation(); showPrev(); };

        const nextBtn = document.createElement('div');
        nextBtn.className = 'grok-slideshow-nav';
        nextBtn.id = 'grok-nav-next';
        nextBtn.innerHTML = '&#10095;';
        nextBtn.onclick = (e) => { e.stopPropagation(); showNext(); };

        // --- フッターエリア (画像と被らないためのコンテナ) ---
        const footer = document.createElement('div');
        footer.id = 'grok-slideshow-footer';

        // カウンター
        counter = document.createElement('div');
        counter.id = 'grok-slideshow-counter';
        
        // コントロールパネル
        const controlsPanel = document.createElement('div');
        controlsPanel.id = 'grok-controls-panel';

        const downloadSingleBtn = document.createElement('button');
        downloadSingleBtn.className = 'grok-action-btn';
        downloadSingleBtn.innerHTML = '💾 保存';
        downloadSingleBtn.onclick = (e) => {
            e.stopPropagation();
            downloadCurrentImage();
        };

        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'grok-action-btn';
        downloadAllBtn.innerHTML = '📦 全保存';
        downloadAllBtn.onclick = (e) => {
            e.stopPropagation();
            downloadAllImagesAsZip(downloadAllBtn);
        };

        controlsPanel.appendChild(downloadSingleBtn);
        controlsPanel.appendChild(downloadAllBtn);

        // フッターに配置
        footer.appendChild(counter);       // 左側
        footer.appendChild(controlsPanel); // 右側

        // 通知 (フッターの上)
        notification = document.createElement('div');
        notification.id = 'grok-slideshow-notification';
        notification.innerText = 'Loading...'; // 短く

        // オーバーレイへの配置順序
        overlay.appendChild(closeBtn);
        overlay.appendChild(mainImage); // Flex 1 で最大化
        overlay.appendChild(footer);    // 下部に固定
        
        overlay.appendChild(prevBtn);   // 矢印は絶対配置
        overlay.appendChild(nextBtn);
        overlay.appendChild(notification);

        overlay.addEventListener('click', (e) => {
            if (footer.contains(e.target)) return;
            if (e.target === overlay || e.target === mainImage) closeSlideshow();
        });

        document.body.appendChild(overlay);
    }

    function getFormattedDate() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `${y}${m}${d}${h}${min}${s}${ms}`;
    }

    function downloadCurrentImage() {
        if (globalImageList.length === 0) return;
        
        const src = globalImageList[currentIndex];
        const filename = `${SAVE_DIR_NAME}/${getFormattedDate()}.jpg`;

        chrome.runtime.sendMessage({
            action: "download_single",
            url: src,
            filename: filename
        });
    }

    async function downloadAllImagesAsZip(btnElement) {
        if (typeof JSZip === 'undefined') {
            alert('ZIPライブラリが正しく読み込まれていません。');
            return;
        }
        if (globalImageList.length === 0) return;

        const originalText = btnElement.innerHTML;
        btnElement.innerHTML = '⏳...';
        btnElement.classList.add('grok-loading');

        try {
            const zip = new JSZip();
            const folder = zip.folder(SAVE_DIR_NAME); 

            globalImageList.forEach((src, index) => {
                const base64Data = src.split(',')[1];
                if (!base64Data) return;
                let timestamp = getFormattedDate();
                let filename = `${timestamp}_${String(index).padStart(3, '0')}.jpg`;
                folder.file(filename, base64Data, {base64: true});
            });

            const contentBase64 = await zip.generateAsync({type: "base64"});
            const dataUrl = "data:application/zip;base64," + contentBase64;
            const zipFilename = `${SAVE_DIR_NAME}/grok_images_${getFormattedDate()}.zip`;

            chrome.runtime.sendMessage({
                action: "download_zip",
                url: dataUrl,
                filename: zipFilename
            });

        } catch (err) {
            console.error(err);
            alert('ZIP作成失敗: ' + err.message);
        } finally {
            btnElement.innerHTML = originalText;
            btnElement.classList.remove('grok-loading');
        }
    }

    // --- スキャン・スクロールロジック ---

    let scanTimeout = null;
    function requestScan() {
        if (scanTimeout) return;
        scanTimeout = setTimeout(() => {
            scanImages();
            scanTimeout = null;
        }, 500);
    }

    function scanImages() {
        if (isScanning) return;
        isScanning = true;

        const domImgs = document.querySelectorAll('div[role="list"] img[alt="Generated image"]');
        
        domImgs.forEach(img => {
            if (img.dataset.grokId) {
                attachButtonToImage(img);
                return; 
            }

            const src = img.src;
            if (!src) return;
            if (img.naturalWidth === 0 || img.naturalHeight === 0) return;

            // 縦横対応のサイズチェック
            const isLandscapeOK = (img.naturalWidth >= MIN_IMAGE_WIDTH && img.naturalHeight >= MIN_IMAGE_HEIGHT);
            const isPortraitOK = (img.naturalWidth >= MIN_IMAGE_HEIGHT && img.naturalHeight >= MIN_IMAGE_WIDTH);

            if (!isLandscapeOK && !isPortraitOK) return;

            if (src.length < MIN_DATA_LENGTH) return;

            let index;
            if (imageIndexMap.has(src)) {
                index = imageIndexMap.get(src);
            } else {
                index = globalImageList.length;
                globalImageList.push(src);
                imageIndexMap.set(src, index);
            }

            img.dataset.grokId = index;
            attachButtonToImage(img);
        });

        if (isSlideshowActive) {
            updateCounter();
        }
        isScanning = false;
    }

    function attachButtonToImage(img) {
        const listItem = img.closest('div[role="listitem"]');
        if (!listItem) return;
        if (listItem.querySelector('.grok-expand-btn')) return;

        if (getComputedStyle(listItem).position === 'static') {
            listItem.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.className = 'grok-expand-btn';
        btn.innerText = '⤢ Full';
        
        btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const id = img.dataset.grokId;
            if (id !== undefined) {
                currentIndex = parseInt(id, 10);
                openSlideshow();
            } else {
                scanImages();
                if (img.dataset.grokId) {
                    currentIndex = parseInt(img.dataset.grokId, 10);
                    openSlideshow();
                } else {
                    const sizeKB = Math.round(img.src.length * 0.75 / 1024);
                    alert(`画像が表示条件を満たしていません。\n(Size: ${img.naturalWidth}x${img.naturalHeight}, Data: ${sizeKB}KB)`);
                }
            }
        };
        listItem.appendChild(btn);
    }

    function startObserving() {
        const observerConfig = { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] };
        const observer = new MutationObserver(() => requestScan());
        const bodyObserver = new MutationObserver(() => {
            const listContainer = document.querySelector('div[role="list"]');
            if (listContainer) {
                observer.observe(listContainer, observerConfig);
                requestScan();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function openSlideshow() {
        if (globalImageList.length === 0) {
            requestScan();
            if (globalImageList.length === 0) return;
        }
        isSlideshowActive = true;
        overlay.classList.add('active');
        updateSlide();
    }

    function closeSlideshow() {
        isSlideshowActive = false;
        overlay.classList.remove('active');
    }

    function updateSlide() {
        if (globalImageList.length === 0) return;
        const src = globalImageList[currentIndex];
        mainImage.src = src;
        updateCounter();
    }
    
    function updateCounter() {
        if (counter) {
            counter.innerText = `${currentIndex + 1} / ${globalImageList.length}`;
        }
    }

    function showNext() {
        if (globalImageList.length === 0) return;
        
        if (currentIndex < globalImageList.length - 1) {
            currentIndex++;
            updateSlide();
            triggerScrollIfNearEnd();
        }
    }

    function showPrev() {
        if (globalImageList.length === 0) return;
        if (currentIndex > 0) {
            currentIndex--;
            updateSlide();
        }
    }

    function triggerScrollIfNearEnd() {
        const remaining = globalImageList.length - (currentIndex + 1);
        if (remaining < SCROLL_TRIGGER_THRESHOLD) {
            const scrollContainer = findScrollContainer();
            if (scrollContainer) {
                showNotification();
                scrollContainer.scrollTo({
                    top: scrollContainer.scrollHeight,
                    behavior: 'smooth'
                });
                setTimeout(requestScan, 1000);
            }
        }
    }

    function findScrollContainer() {
        let el = document.querySelector('div[role="list"]');
        while (el) {
            const style = window.getComputedStyle(el);
            const isScrollable = (style.overflowY === 'scroll' || style.overflowY === 'auto') 
                                 && el.scrollHeight > el.clientHeight;
            if (isScrollable) return el;
            el = el.parentElement;
        }
        return document.documentElement || document.body;
    }

    function showNotification() {
        if (!notification) return;
        notification.style.opacity = '1';
        setTimeout(() => { notification.style.opacity = '0'; }, 2000);
    }

    function handleKeydown(e) {
        if (!isSlideshowActive) {
            if (e.key.toLowerCase() === 'i') {
                requestScan();
                if (globalImageList.length > 0) {
                    currentIndex = globalImageList.length - 1;
                    openSlideshow();
                }
            }
            return;
        }

        switch (e.key) {
            case 'ArrowRight':
            case 'l':
                showNext();
                break;
            case 'ArrowLeft':
            case 'h':
                showPrev();
                break;
            case 'Escape':
                closeSlideshow();
                break;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();