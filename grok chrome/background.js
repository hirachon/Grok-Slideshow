// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "download_single") {
        // 個別画像のダウンロード (ダイアログなしで強制保存)
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            saveAs: false, // <--- これが重要！ダイアログを強制的にOFFにします
            conflictAction: 'uniquify'
        });
    }
    else if (request.action === "download_zip") {
        // ZIPのダウンロード (Base64データを受け取って保存)
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            saveAs: false, // ZIPもダイアログなし
            conflictAction: 'uniquify'
        });
    }
});