// ====== 変数定義ブロック ======
// キャンバス・ルーレット制御用のグローバル変数
const canvas = document.getElementById('diskCanvas');
const ctx = canvas.getContext('2d');
let radius = parseInt(document.getElementById('sizeSlider').value, 10);
// ポインターがはみ出す分を含めた、円盤まわりの余白
const POINTER_EXTENT = 85;
// 高解像度画面用の描画倍率（resizeCanvas で設定）
const MAX_PIXEL_RATIO = 2; // 3倍で描いても見た目はほぼ変わらず重くなるだけなので、2倍までにする
let canvasPixelRatio = 1;
let centerX = 0;
let centerY = 0;
resizeCanvas();
let angleOffset = 0;
let texts = [];
let visibleTexts = [];
let segmentVisibility = {};
let lastUpdateTime = Date.now();

// スピン制御用の変数
let spinning = false;
let spinSpeed = 0.001;
const maxSpinSpeed = 0.05;
const spinAcceleration = 0.005;
const inertiaDecay = 0.99;
// 加速・減速は「60fpsの1フレーム（約16.7ms）あたり」の値として扱い、画面のリフレッシュレートに左右されないようにする
const FRAME_MS = 1000 / 60;
// タブ切り替えなどで時間が大きく飛んだときに、一気に回りすぎないようにする上限
const MAX_DELTA_MS = 100;

// スクリーンショット用のフラグ
let shiftPressed = false;
let sPressed = false;
let rPressed = false;

// 音声・設定用の変数
let audioCtx;
let lastPointedText = "";
let isSoundEnabled = false;
let isAutoDisableEnabled = true;
let lastTick = -1;

// 回転中は項目のチェックを操作できないようにするためのフラグ
let isSpinLocked = false;

// 履歴機能用の変数
let winningHistory = [];
let isHistoryVisible = false;

// ====== 初期化（ページ読み込み時）ブロック ======
document.addEventListener('DOMContentLoaded', function () {
    console.log('ページが読み込まれました。');

    // 1. テキストエリアの復元
    const savedText = localStorage.getItem('textareaContent');
    if (savedText) {
        document.getElementById('inputArea').value = savedText;
        texts = savedText.trim().split('\n').filter(line => line.trim() !== "");
    }

    // 2. モーダルのオーバーレイテキストの復元
    const savedOverlayText = localStorage.getItem('overlayTextContent');
    if (savedOverlayText !== null) {
        const textOverlayInput = document.getElementById('textOverlayInput');
        textOverlayInput.value = savedOverlayText;
        displayTextOnModal(savedOverlayText);
    }

    // 3. チェックボックスの表示状態の復元
    const savedVisibility = localStorage.getItem('segmentVisibility');
    if (savedVisibility) {
        segmentVisibility = JSON.parse(savedVisibility);
    }

    // 4. 結果表示カード編集コンテナの初期非表示設定
    document.getElementById('textOverlayInputContainer').style.display = 'none';

    // 5. 設定系の復元
    /*
    const savedSound = localStorage.getItem('isSoundEnabled');
    if (savedSound !== null) isSoundEnabled = JSON.parse(savedSound);
    document.getElementById('soundToggle').checked = isSoundEnabled;
*/

    const savedAutoDisable = localStorage.getItem('isAutoDisableEnabled');
    if (savedAutoDisable !== null) isAutoDisableEnabled = JSON.parse(savedAutoDisable);
    document.getElementById('autoDisableToggle').checked = isAutoDisableEnabled;

    const savedHistory = localStorage.getItem('winningHistory');
    if (savedHistory) {
        winningHistory = JSON.parse(savedHistory);
    }

    // 6. 初期描画
    updateCheckBoxList();
    recalculateSegmentsAndDraw();

    // 履歴エリアの開閉状態の記憶を呼び起こすの！
    const savedHistoryVisible = localStorage.getItem('isHistoryVisible');
    if (savedHistoryVisible !== null) {
        isHistoryVisible = JSON.parse(savedHistoryVisible);
        if (isHistoryVisible) {
            // 開いていた記憶があれば、エリアを表示してボタン名も変えるの！
            document.getElementById('historyContainer').style.display = 'block';
            document.getElementById('historyButton').textContent = '履歴非表示';
        }
    }
    
    // ページ読み込み時に、裏側で履歴の中身も最新にしておくの！
    updateHistoryDisplay();
});


// ====== UI・イベントリスナーブロック ======

// ファイルドラッグ＆ドロップ（CSV読み込み）
const inputArea = document.getElementById('inputArea');
inputArea.addEventListener('dragover', (event) => event.preventDefault());
inputArea.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];

    if (!file || (!file.type.includes('csv') && !file.name.toLowerCase().endsWith('.csv'))) {
        alert('CSVファイルをドロップしてください。');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const arrayBuffer = event.target.result;
            const text = decodeCsvText(new Uint8Array(arrayBuffer));
            // カンマ・改行（Windowsの\r\nを含む）で区切って、1行1項目にする
            const formattedText = text.split(/\r\n|\r|\n|,/)
                .map(item => item.trim())
                .filter(item => item !== '')
                .join('\n');
            setInputText(formattedText);
        } catch (e) {
            console.error("ファイルの読み込みに失敗しました: ", e);
            alert('ファイルの読み込みに失敗しました。');
        }
    };
    reader.readAsArrayBuffer(file);
});

// CSVの文字コードを自動判定して読む関数。
// GoogleスプレッドシートやMacで作ったCSVは UTF-8、日本語WindowsのExcelで作ったCSVは Shift-JIS が多いの。
// まず UTF-8 として厳密に読んでみて（fatal: true で、UTF-8として正しくなければエラーになる）、
// ダメだったら Shift-JIS で読み直すの！（先頭のBOMは UTF-8 の読み込みで自動的に取り除かれるの）
function decodeCsvText(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
        return new TextDecoder('shift-jis').decode(bytes);
    }
}

// テキストエリア入力時の保存と再描画
document.getElementById('inputArea').addEventListener('input', function () {
    const inputValue = this.value.trim();
    localStorage.setItem('textareaContent', inputValue);
    const newTexts = inputValue.split('\n').filter(line => line.trim() !== "");

    if (newTexts.length === 0) {
        segmentVisibility = {};
        winningHistory = [];
        localStorage.removeItem('textareaContent');
    } else {
        const newSegmentVisibility = {};
        const newHistory = [];

        // 1. チェックボックスのON/OFF状態を引き継ぐの！
        newTexts.forEach(newText => {
            const newName = newText.split('*')[0].trim(); // 名前だけを抽出
            
            // 変更前のテキストリストから、同じ名前のものを探すの！
            const oldText = texts.find(t => t.split('*')[0].trim() === newName);
            
            if (oldText && segmentVisibility[oldText] !== undefined) {
                // 同じ名前があったら、昔のON/OFF状態を新しいテキストに引き継ぐの！
                newSegmentVisibility[newText] = segmentVisibility[oldText];
            } else {
                newSegmentVisibility[newText] = true; // 新しく追加された項目はONにするの
            }
        });

        // 2. 履歴リストの中身も新しい文字列（倍率変更後）にアップデートするの！
        winningHistory.forEach(oldHistoryText => {
            const oldName = oldHistoryText.split('*')[0].trim();
            const newTextMatch = newTexts.find(t => t.split('*')[0].trim() === oldName);
            
            if (newTextMatch) {
                // 名前が一致する最新のテキストがあれば、それを新しい履歴として残すの！
                newHistory.push(newTextMatch);
            }
        });

        segmentVisibility = newSegmentVisibility;
        winningHistory = newHistory;
    }

    texts = newTexts; // 新しいテキストリストを正式に反映するの！
    localStorage.setItem('winningHistory', JSON.stringify(winningHistory));

    // 画面の表示も全部アップデートするの！
    updateHistoryDisplay();
    updateCheckBoxList();
    saveCheckBoxState();
    recalculateSegmentsAndDraw();
});

// サイズスライダーの変更
document.getElementById('sizeSlider').addEventListener('input', function () {
    radius = parseInt(this.value, 10);
    resizeCanvas();
    recalculateSegmentsAndDraw();
});

// 入力欄の内容をプログラムから書き換える共通処理。
// input イベントを発火させて、保存・チェック状態の引き継ぎ・履歴の更新・再描画を
// 手入力のときと同じ流れで行うの！
function setInputText(value) {
    inputArea.value = value;
    inputArea.dispatchEvent(new Event('input'));
}

// 円盤の大きさに合わせてキャンバスのサイズを決める関数。
// 円盤＋ポインターがぴったり収まる大きさにすることで、スマホで縮小表示しても円盤が大きく見えるの！
//
// 高解像度の画面（Retinaなど）では、1px の中に実際のドットが2〜3個あるの。
// キャンバスの中身をその分だけ細かく描いて、表示サイズは元のままにすることで、
// 円盤や文字がぼやけずにくっきり見えるの！
// （描画の座標は今まで通りの「見た目のpx」で書けるように、setTransform で拡大しておく）
function getPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

function resizeCanvas() {
    const width = 2 * (radius + POINTER_EXTENT);
    const height = 2 * radius + 40;
    canvasPixelRatio = getPixelRatio();

    canvas.width = Math.round(width * canvasPixelRatio);
    canvas.height = Math.round(height * canvasPixelRatio);
    canvas.style.width = `${width}px`; // 高さは縦横比から自動で決まるの
    ctx.setTransform(canvasPixelRatio, 0, 0, canvasPixelRatio, 0, 0);

    centerX = width / 2;
    centerY = radius + 20;
    // PCレイアウトでは、スタートボタンを円盤のすぐ下に置くの
    document.getElementById('toggleButton').style.top = `${height}px`;
}

// ブラウザの拡大縮小や、解像度の違うモニターへの移動で倍率が変わったら描き直すの
window.addEventListener('resize', () => {
    if (getPixelRatio() !== canvasPixelRatio) {
        resizeCanvas();
        recalculateSegmentsAndDraw();
    }
});

// サウンドON/OFF切り替え
document.getElementById('soundToggle').addEventListener('change', function () {
    isSoundEnabled = this.checked;
    localStorage.setItem('isSoundEnabled', isSoundEnabled);
});

// 自動OFF機能切り替え
document.getElementById('autoDisableToggle').addEventListener('change', function () {
    isAutoDisableEnabled = this.checked;
    localStorage.setItem('isAutoDisableEnabled', isAutoDisableEnabled);
});

// 入力例ボタン（書き換え: / を * に変更）
document.getElementById('exampleInputButton').addEventListener('click', function () {
    const exampleText = 'りんご\nみかん*0.5\nいちご\nバナナ*2';

    // 今までの履歴を綺麗にクリアしてから、入力欄に反映（保存も含む）するの！
    winningHistory = [];
    setInputText(exampleText);
});

// 項目全削除ボタン
document.getElementById('clearInputButton').addEventListener('click', function () {
    // 入力欄を空にして、保存内容（項目・表示状態・履歴）もまとめて消すの！
    setInputText('');
});

// 履歴表示ボタンの処理
document.getElementById('historyButton').addEventListener('click', function () {
    const historyContainer = document.getElementById('historyContainer');
    if (historyContainer.style.display === 'none' || historyContainer.style.display === '') {
        historyContainer.style.display = 'block';
        this.textContent = '履歴非表示';
        isHistoryVisible = true;
        localStorage.setItem('isHistoryVisible', true);
        updateHistoryDisplay(); // 表示する時に最新の状態にするの！
    } else {
        historyContainer.style.display = 'none';
        this.textContent = '履歴表示';
        isHistoryVisible = false;
        localStorage.setItem('isHistoryVisible', false);
    }
});

// ランダムボタン（書き換え: / を * に変更して分割・結合）
document.getElementById('randomizeButton').addEventListener('click', function () {
    const inputTexts = document.getElementById('inputArea').value.trim().split('\n').filter(line => line.trim() !== "");
    const itemsWithMultipliers = inputTexts.map(text => {
        const [item, multiplier] = text.split('*');
        return { item, multiplier };
    });

    for (let i = itemsWithMultipliers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [itemsWithMultipliers[i], itemsWithMultipliers[j]] = [itemsWithMultipliers[j], itemsWithMultipliers[i]];
    }

    const randomizedText = itemsWithMultipliers.map(({ item, multiplier }) => multiplier !== undefined ? `${item}*${multiplier}` : item).join('\n');
    // 並び替えた結果を保存するの（チェック状態・履歴は名前で引き継がれるの）
    setInputText(randomizedText);
});

// 使用法ボタン（書き換え: 説明文の / を * に変更）
document.getElementById('descriptionInputButton').addEventListener('click', function () {
    const existingDescriptionContainer = document.getElementById('descriptionContainer');
    if (existingDescriptionContainer) {
        existingDescriptionContainer.remove();
        return;
    }

    const descriptionContainer = document.createElement('div');
    descriptionContainer.id = 'descriptionContainer';
    const descriptions = [
        "【使用法】",
        "・項目を「項目入力欄」に入力します。",
        "・改行で項目を増やせます。",
        "・項目の後ろに「*数字」と入力すると倍率を指定できます（数字以外や0以下は1倍として扱います）。",
        "・項目欄下のチェックを外すと項目を見えなくすることができます。",
        "・項目入力欄に「CSVファイル」をドロップして読み込むこともできます。",
        "・「入力例」ボタンで、初期サンプルが表示されます。",
        "・右下「ランダム」ボタンで、項目の場所が入れ替わります。",
        "・右下「項目全削除」ボタンで、入力文字が削除されます。",
        "・左下「結果表示カード編集」ボタンで、カードに表示する文字を編集します。",
        "・結果が表示された時、「shift + s + r」キーで、スクリーンショットを保存できます。"
    ];

    descriptions.forEach(text => {
        const p = document.createElement('p');
        p.textContent = text;
        descriptionContainer.appendChild(p);
    });

    descriptionContainer.addEventListener('click', () => descriptionContainer.remove());
    document.body.appendChild(descriptionContainer);
});

// スタート・ストップボタン（書き換え: 重複チェックの / を * に変更）
const randomizeButton = document.getElementById('randomizeButton');
const clearInputButton = document.getElementById('clearInputButton');
const toggleButton = document.getElementById('toggleButton');

toggleButton.addEventListener('click', function () {
    randomizeButton.disabled = true;
    clearInputButton.disabled = true;

    // ブラウザの音声再生制限を解除するために、初回クリック時にAudioContextを準備するの！
    if (isSoundEnabled && !audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const inputTexts = document.getElementById('inputArea').value.trim();
    if (inputTexts.length === 0) {
        alert('［入力例］ボタンを押すなど、項目を入力してください。');
        randomizeButton.disabled = false;
        clearInputButton.disabled = false;
        return;
    }

    const itemNames = texts.map(text => text.split('*')[0].trim());
    const uniqueItemNames = new Set(itemNames);
    if (uniqueItemNames.size !== itemNames.length) {
        alert('項目名は全て違う名前にして下さい。');
        randomizeButton.disabled = false;
        clearInputButton.disabled = false;
        return;
    }

    if (!spinning) {
        spinning = true;
        setSpinLock(true);
        toggleButton.textContent = "ストップ";
        toggleButton.className = 'button stopButton';
        spinSpeed = 0.01;
        lastUpdateTime = Date.now();
        requestAnimationFrame(spinDisk);
    } else {
        spinning = false;
    }
});

// ====== 全表示・全非表示ボタンの処理 ======
document.getElementById('checkAllBtn').addEventListener('click', function () {
    // 全ての項目の状態を true (表示) にする
    texts.forEach(text => {
        segmentVisibility[text] = true;
    });
    
    // ↓追加：ボタンを押したら履歴もクリアするの！
    winningHistory = [];
    localStorage.removeItem('winningHistory');
    updateHistoryDisplay();
    // ↑ここまで追加なの！
    
    saveCheckBoxState();
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
});

document.getElementById('uncheckAllBtn').addEventListener('click', function () {
    // 全ての項目の状態を false (非表示) にする
    texts.forEach(text => {
        segmentVisibility[text] = false;
    });
    
    // ↓追加：ボタンを押したら履歴もクリアするの！
    winningHistory = [];
    localStorage.removeItem('winningHistory');
    updateHistoryDisplay();
    // ↑ここまで追加なの！
    
    saveCheckBoxState();
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
});


// ====== ResizeObserverのブロック ======
let isListDragged = false; // ドラッグされたかどうかのフラグなの！

// ResizeObserverを使って、テキストエリアの大きさが変わったかを常に監視するの！
const resizeObserver = new ResizeObserver(entries => {
    if (isListDragged) return; // 一度でも手で動かしたら、もう自動追従はしないの！

    for (let entry of entries) {
        const inputHeight = entry.target.offsetHeight;
        const inputTop = entry.target.offsetTop;
        const dragContainer = document.getElementById('dragContainer'); // 箱ごと動かすの！

        if (dragContainer) {
            const newWrapTop = inputTop + inputHeight + 10;
            dragContainer.style.top = `${newWrapTop}px`;
            fitCheckBoxListHeight();
        }
    }
});

// 監視対象（テキストエリア）を登録して、監視スタート！
const inputAreaElem = document.getElementById('inputArea');
if (inputAreaElem) {
    resizeObserver.observe(inputAreaElem);
}

// ====== ドラッグ＆ドロップ機能ブロック ======
const dragContainer = document.getElementById('dragContainer');
const dragHandle = document.getElementById('dragHandle');
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

if (dragHandle && dragContainer) {
    // ハンドルを掴んだ時
    dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        isListDragged = true; // 追従ストップのフラグを立てるの！
        
        // クリックした場所とコンテナの左上のズレを計算しておくの
        const rect = dragContainer.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
    });

    // マウスを動かしている時
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        // 新しい位置を計算して適用するの
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;
        
        // CSSの right 指定を解除して、left と top で動かすようにするの！
        dragContainer.style.right = 'auto';
        dragContainer.style.left = `${newLeft}px`;
        dragContainer.style.top = `${newTop}px`;
    });

    // マウスを離した時
    document.addEventListener('mouseup', () => {
        if (isDragging) fitCheckBoxListHeight();
        isDragging = false;
    });

    // 指でハンドルに触れた時
    dragHandle.addEventListener('touchstart', (e) => {
        isDragging = true;
        isListDragged = true; 
        
        const rect = dragContainer.getBoundingClientRect();
        // スマホの場合は指が複数あるかもしれないから、「1本目の指（touches[0]）」の場所を使うの！
        offsetX = e.touches[0].clientX - rect.left;
        offsetY = e.touches[0].clientY - rect.top;
    }, { passive: false }); // スマホ特有の警告を消すおまじないなの！

    // 指を画面上で滑らせている時
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        // 🚨ここがプロの技！：箱を動かしている時に、画面全体が一緒にスクロールしちゃうのを防ぐの！
        e.preventDefault(); 
        
        let newLeft = e.touches[0].clientX - offsetX;
        let newTop = e.touches[0].clientY - offsetY;
        
        dragContainer.style.right = 'auto';
        dragContainer.style.left = `${newLeft}px`;
        dragContainer.style.top = `${newTop}px`;
    }, { passive: false }); // preventDefault() を使うために必要な設定なの！

    // 指を画面から離した時
    document.addEventListener('touchend', () => {
        if (isDragging) fitCheckBoxListHeight();
        isDragging = false;
    });
}

// ====== モーダル＆カード編集UIブロック ======

document.getElementById('textOverlayInput').addEventListener('input', function () {
    const text = this.value.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;');
    localStorage.setItem('overlayTextContent', this.value);
    displayTextOnModal(text);
});

document.getElementById('insertSampleTextButton').addEventListener('click', function () {
    const sampleText = "\n当選者\n\n\n\n　　　　　　　　さん\n\n　おめでとうございます!";
    const textArea = document.getElementById('textOverlayInput');
    textArea.value = sampleText;
    textArea.dispatchEvent(new Event('input'));
});

document.getElementById('toggleTextOverlayInputContainerButton').addEventListener('click', function () {
    const container = document.getElementById('textOverlayInputContainer');
    if (container.style.display === 'none' || container.style.display === '') {
        container.style.display = 'block';
        this.textContent = '編集欄を閉じる';
    } else {
        container.style.display = 'none';
        this.textContent = '結果表示カード編集';
    }
});

// ====== モーダル（結果表示）制御 ======
window.addEventListener('click', function (event) {
    const modal = document.getElementById('modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
});

window.addEventListener('touchstart', function (event) {
    const modal = document.getElementById('modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
});

// ====== スクリーンショット機能ブロック ======
document.addEventListener('keydown', function (event) {
    if (event.key === 'Shift') shiftPressed = true;
    if (event.key === 's' || event.key === 'S') sPressed = true;
    if (event.key === 'r' || event.key === 'R') rPressed = true;

    const modal = document.querySelector(".modal");
    if (modal.style.display === 'block' && shiftPressed && sPressed && rPressed) {
        html2canvas(modal.querySelector(".modal-content")).then(canvas => {
            var link = document.createElement('a');
            link.download = 'modal-screenshot.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
        shiftPressed = sPressed = rPressed = false;
    }
});

document.addEventListener('keyup', function (event) {
    if (event.key === 'Shift') shiftPressed = false;
    if (event.key === 's' || event.key === 'S') sPressed = false;
    if (event.key === 'r' || event.key === 'R') rPressed = false;
});

const saveImageBtn = document.getElementById('saveImageBtn');
if (saveImageBtn) {
    saveImageBtn.addEventListener('click', function() {
        // スクショを撮るのは、ボタンが含まれない「.modal-content」だけなの！
        const modalContent = document.querySelector(".modal-content");
        html2canvas(modalContent).then(canvas => {
            var link = document.createElement('a');
            link.download = 'result-card.png'; // 保存されるファイル名なの
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
    });
}

// ====== ルーレット・計算ロジックブロック ======

// 指定されたテキストから倍率（*の後の数字）を抽出する関数
// 「りんご*」のように数字が空のときや、数字でない・0以下のときは 1倍として扱うの
function parseMultiplier(text) {
    const parts = text.split('*');
    if (parts.length !== 2) return 1;
    const value = parts[1].trim();
    if (value === '') return 1;
    const multiplier = Number(value);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

// チェックボックスの表示状態を保存する関数
function saveCheckBoxState() {
    localStorage.setItem('segmentVisibility', JSON.stringify(segmentVisibility));
}

// チェックボックスリストを再生成する関数
function updateCheckBoxList() {
    const checkBoxList = document.getElementById('checkBoxList');
    checkBoxList.innerHTML = '';
    texts.forEach((text) => {
        const textWithoutMultiplier = text.split('*')[0];
        const wrapper = document.createElement('div');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = segmentVisibility[text] !== false;
        checkbox.disabled = isSpinLocked;
        checkbox.onchange = () => {
            segmentVisibility[text] = checkbox.checked;
            saveCheckBoxState();
            recalculateSegmentsAndDraw();
            updateHistoryDisplay();
        };

        // 長い名前は「…」で省略表示されるので、マウスを乗せたら全文が見えるようにするの
        wrapper.title = textWithoutMultiplier;
        wrapper.className = 'checkItem';

        const label = document.createElement('label');
        label.appendChild(checkbox); // 1. まずチェックボックスをラベルの中に入れる
        label.appendChild(document.createTextNode(' ' + textWithoutMultiplier)); // 2. その隣に文字を入れる（見やすいように半角スペースを1つ挟むの！）
        wrapper.appendChild(label); // 3. 出来上がったラベルをラッパーに入れる

        checkBoxList.appendChild(wrapper);
    });
    fitCheckBoxListHeight();
}

// 回転中（スタートを押してから完全に止まるまで）は、項目のチェックと
// 「全表示」「全非表示」ボタンを押せないようにする関数なの！
// 回っている途中で項目が消えたり増えたりすると、当選結果がおかしくなるからなの
function setSpinLock(locked) {
    isSpinLocked = locked;
    document.querySelectorAll('#checkBoxList input[type="checkbox"]').forEach(cb => {
        cb.disabled = locked;
    });
    document.getElementById('checkAllBtn').disabled = locked;
    document.getElementById('uncheckAllBtn').disabled = locked;
    document.getElementById('dragContainer').classList.toggle('spinLocked', locked);
}

// ====== チェック一覧の高さ調整 ======
// PC表示では、チェック一覧が画面の下にある「履歴表示」などのボタンや設定に
// かぶらないよう、画面の高さに合わせて一覧の最大の高さを決めるの！
const CHECK_LIST_MAX_HEIGHT = 350;
const CHECK_LIST_MIN_HEIGHT = 80;
const BOTTOM_CONTROLS_SPACE = 130; // 画面下のボタン・設定のために空けておく高さ（一覧の箱の余白込み）
const desktopLayoutQuery = window.matchMedia('(min-width: 1101px)');

function fitCheckBoxListHeight() {
    const list = document.getElementById('checkBoxList');
    if (!list) return;
    if (!desktopLayoutQuery.matches) {
        list.style.maxHeight = ''; // スマホ表示ではCSSの指定に任せるの
        return;
    }
    const available = window.innerHeight - BOTTOM_CONTROLS_SPACE - list.getBoundingClientRect().top;
    const maxHeight = Math.max(CHECK_LIST_MIN_HEIGHT, Math.min(CHECK_LIST_MAX_HEIGHT, available));
    list.style.maxHeight = `${maxHeight}px`;
}

window.addEventListener('resize', fitCheckBoxListHeight);
desktopLayoutQuery.addEventListener('change', fitCheckBoxListHeight);

// 円盤を回転させるアニメーション関数
function spinDisk() {
    const now = Date.now();
    const deltaTime = Math.min(now - lastUpdateTime, MAX_DELTA_MS);
    // 60fps換算で何フレーム分の時間が経ったか（120Hzの画面なら約0.5）
    const frames = deltaTime / FRAME_MS;

    if (spinning) {
        spinSpeed = Math.min(spinSpeed + spinAcceleration * frames, maxSpinSpeed);
    } else {
        spinSpeed *= Math.pow(inertiaDecay, frames);

        if (spinSpeed <= 0.00005) {
            spinSpeed = 0;
            setSpinLock(false);
            toggleButton.textContent = "スタート";
            toggleButton.className = 'button startButton';
            toggleButton.disabled = false;
            randomizeButton.disabled = false;
            clearInputButton.disabled = false;

            const winningText = document.getElementById('pointedText').textContent;

            // 当選履歴に記録する処理なの！
            const originalText = texts.find(t => t.split('*')[0] === winningText);
            if (originalText) {
                // すでに履歴に存在していたら、一旦古いものを除外（削除）するの！
                winningHistory = winningHistory.filter(item => item !== originalText);
                
                // そして、改めて一番最後（一番下）に追加し直すの！
                winningHistory.push(originalText);
                localStorage.setItem('winningHistory', JSON.stringify(winningHistory)); // 保存もしておくの！
            }

            playResultSound();

            if (isAutoDisableEnabled && visibleTexts.length > 0) {
                // 元のテキストフォーマット（名前*倍率）を検索してOFFにする
                const originalText = texts.find(t => t.split('*')[0] === winningText);
                if (originalText) {
                    segmentVisibility[originalText] = false;
                    saveCheckBoxState();
                    updateCheckBoxList();
                    recalculateSegmentsAndDraw();
                    updateHistoryDisplay();
                }
            }

            showModal(winningText);
            return;
        }
        toggleButton.disabled = true;
    }

    angleOffset += (spinSpeed * deltaTime) % (2 * Math.PI);

    // ルーレット全体(2π)を等分した角度を計算
    const tickAngle = (2 * Math.PI) / 3;
    // 現在の総回転角度が、等分のうちの何番目のブロックにいるか計算
    const currentTick = Math.floor(angleOffset / tickAngle);

    // 前のブロックから新しいブロックに移動した瞬間（境界線を越えた時）に音を鳴らす！
    if (currentTick !== lastTick) {
        playSound();
        lastTick = currentTick; // 鳴らした場所を更新
    }
    recalculateSegmentsAndDraw();
    lastUpdateTime = now;
    if (spinSpeed > 0) requestAnimationFrame(spinDisk);
}

// ルーレットのセグメントを再計算して描画する関数
function recalculateSegmentsAndDraw() {
    visibleTexts = texts.filter(text => segmentVisibility[text] !== false);
    const totalMultiplier = visibleTexts.reduce((total, text) => total + parseMultiplier(text), 0);
    const baseAngle = (2 * Math.PI) / totalMultiplier;

    // setTransform で拡大しているので、見た目のpxで全体を消す
    ctx.clearRect(0, 0, canvas.width / canvasPixelRatio, canvas.height / canvasPixelRatio);

    // 白い縁（ふんわりした影をつけて、円盤を背景から浮かせるの）
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + WHEEL_RIM_WIDTH, 0, Math.PI * 2, false);
    ctx.fillStyle = WHEEL_RIM_COLOR;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fill();
    ctx.restore();

    // 各項目の扇形の角度を先に計算しておくの
    let currentAngle = 0;
    const segments = visibleTexts.map(text => {
        const segmentAngle = baseAngle * parseMultiplier(text);
        const segment = {
            label: text.split('*')[0].trim(),
            color: getSegmentColor(currentAngle),
            start: currentAngle + angleOffset,
            end: currentAngle + segmentAngle + angleOffset
        };
        currentAngle += segmentAngle;
        return segment;
    });

    // 1. 扇形を塗る → 2. 白い区切り線 → 3. 項目名 の順に描くと、線が文字に重ならないの
    segments.forEach(seg => drawSegment(seg.start, seg.end, seg.color));
    if (segments.length > 1) {
        segments.forEach(seg => drawSegmentSeparator(seg.start));
    }
    segments.forEach(seg => drawSegmentLabel(seg.label, seg.start, seg.end));

    drawPointer();
    updatePointedText();

    // ルーレットが回っていない時だけ、ボタンの有効/無効を判定するの！
    const toggleBtn = document.getElementById('toggleButton');
    // ボタンが「スタート」の時（＝完全に止まっている時）だけ、安全装置を動かすの！
    if (toggleBtn.textContent === "スタート") {
        if (visibleTexts.length === 0) {
            toggleBtn.disabled = true; // 0個ならグレーアウトして押せなくする
        } else {
            toggleBtn.disabled = false; // 1個以上あれば押せるようにする
        }
    }
}

// ====== 円盤の配色ブロック（パステル調） ======
const WHEEL_SATURATION = 80;    // 彩度（%）。100だと原色でギラギラするので控えめに
const WHEEL_LIGHTNESS = 72;     // 明度（%）。少し高めにして、明るくやわらかい色合いに
// 色相は赤(0°)から一周させず 320°（赤紫）までにして、最初と最後の項目が同じような赤にならないようにするの
const WHEEL_HUE_RANGE = 320;
const WHEEL_RIM_COLOR = '#ffffff';
const WHEEL_RIM_WIDTH = 6;
const WHEEL_SEPARATOR_COLOR = '#ffffff';
const WHEEL_SEPARATOR_WIDTH = 3;

// 扇形の開始位置（0〜2π）から、その項目の色を決める関数
function getSegmentColor(startAngle) {
    const hue = (startAngle / (2 * Math.PI)) * WHEEL_HUE_RANGE;
    return `hsl(${hue}, ${WHEEL_SATURATION}%, ${WHEEL_LIGHTNESS}%)`;
}

// 1つの扇型セグメントを塗る関数
function drawSegment(angleStart, angleEnd, color) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angleStart, angleEnd);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

// 項目どうしの境目に白い線を引く関数
function drawSegmentSeparator(angle) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
    ctx.strokeStyle = WHEEL_SEPARATOR_COLOR;
    ctx.lineWidth = WHEEL_SEPARATOR_WIDTH;
    ctx.stroke();
}

// ====== 項目名の文字サイズ自動調整ブロック ======
// 元々の円盤の文字と同じ Arial（日本語はOS標準のゴシック体で表示される）・標準の太さにするの
const LABEL_FONT_FAMILY = 'Arial, sans-serif';
const LABEL_FONT_WEIGHT = 'normal';
const LABEL_COLOR = '#222';
const LABEL_MIN_FONT = 10;           // これより小さくはしない（入り切らない分は「…」で省略）
const LABEL_MAX_FONT_RATIO = 0.24;   // 文字サイズの上限（半径に対する割合）
const LABEL_OUTER_RATIO = 0.94;      // 文字を置ける一番外側（半径に対する割合）
const LABEL_FILL_RATIO = 0.9;        // 扇形の幅いっぱいではなく、少し余白を残す
const labelWidthCache = new Map();   // 文字サイズ1pxあたりの文字幅のキャッシュ（毎フレーム測り直さないため）

function getLabelFont(fontSize) {
    return `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
}

// 横書きの文字の四角形を、ちょうど囲む円の半径を「文字サイズ1pxあたり」で返す関数。
// 文字の高さは文字サイズとほぼ同じなので、半径 = √((幅/2)² + (高さ/2)²)
function getLabelCircleRadiusPerPx(text) {
    if (!labelWidthCache.has(text)) {
        ctx.font = getLabelFont(100);
        const widthPerPx = ctx.measureText(text).width / 100;
        labelWidthCache.set(text, Math.sqrt((widthPerPx / 2) ** 2 + 0.25));
    }
    return labelWidthCache.get(text);
}

// 扇形の中に収まる、できるだけ大きな文字サイズで項目名を「横書き」で描く関数。
//
// 横書きの文字は円盤が回ると扇形に対する向きが変わるので、そのまま計算すると
// 回転中に文字の大きさがコロコロ変わってしまうの。
// そこで「文字の四角形をすっぽり囲む円」が扇形に入る大きさで考えると、
// 向きに関係なく同じ大きさになるの！
//   ・扇形の中心線上、中心から距離 d の位置に半径 R の円を置くと、
//     扇形の辺にぶつからない条件は R ≦ d × sin(扇形の角度 / 2)
//   ・外周にぶつからない条件は d + R ≦ 外側の限界
//   この2つを両方満たす一番大きな円は R = 外側 × sin / (1 + sin)
function drawSegmentLabel(text, angleStart, angleEnd) {
    if (!text) return;

    const segmentAngle = angleEnd - angleStart;
    const midAngle = (angleStart + angleEnd) / 2;
    const outer = radius * LABEL_OUTER_RATIO;

    // 半分以上の大きさの扇形では、sin は最大 1 として扱う。
    // 項目が最後の1つになったとき（扇形が円全体）も同じ計算になるので、文字は中心ではなく
    // 端に寄った位置に置かれて、円盤と一緒にぐるぐる回るから「回っている感」が出るの！
    const halfSin = Math.sin(Math.min(segmentAngle / 2, Math.PI / 2)) * LABEL_FILL_RATIO;
    const maxCircle = (outer * halfSin) / (1 + halfSin); // 文字を囲む円の、最大の半径

    let label = text;
    let circlePerPx = getLabelCircleRadiusPerPx(label);
    let fontSize = Math.min(radius * LABEL_MAX_FONT_RATIO, maxCircle / circlePerPx);

    // 最小サイズでも入り切らない長い名前は、末尾を「…」にして縮めるの
    if (fontSize < LABEL_MIN_FONT) {
        fontSize = LABEL_MIN_FONT;
        while (label.length > 1 && circlePerPx * LABEL_MIN_FONT > maxCircle) {
            label = label.slice(0, -1);
            circlePerPx = getLabelCircleRadiusPerPx(label + '…');
        }
        if (label !== text) label += '…';
        // 扇形が細すぎて、1文字すら入らないときは描かない
        if (circlePerPx * LABEL_MIN_FONT > maxCircle * 1.5) return;
    }

    // 文字を囲む円が置ける範囲（扇形の辺にぶつからない内側の限界〜外周）の真ん中に置くの
    const circle = circlePerPx * fontSize;
    const innerLimit = circle / halfSin;
    const outerLimit = outer - circle;
    const centerDist = (innerLimit + outerLimit) / 2; // 中心からの距離（扇形の中心線上）

    ctx.save();
    ctx.font = getLabelFont(fontSize);
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
        label,
        centerX + centerDist * Math.cos(midAngle),
        centerY + centerDist * Math.sin(midAngle)
    );
    ctx.restore();
}

// 赤いポインターを描画する関数
function drawPointer() {
    const pointerWidth = 50;
    const pointerHeight = 10;
    ctx.beginPath();
    ctx.moveTo(centerX + radius - 20, centerY);
    ctx.lineTo(centerX + radius + 20 + pointerWidth, centerY - pointerHeight);
    ctx.lineTo(centerX + radius + 20 + pointerWidth, centerY + pointerHeight);
    ctx.closePath();

    ctx.fillStyle = 'red';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// Web Audio APIを使用して短い電子音を鳴らす関数
function playSound() {
    if (!isSoundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine'; // 正弦波（ポッという柔らかい音）
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // 周波数800Hz

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // 音量を0.1に
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05); // 0.05秒で消える

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.05);
}

// 関数の主要な機能コメント：当選結果が出た時に、メロディ・和音・ベースラインのアンサンブルで豪華なファンファーレを鳴らす関数なの！
function playResultSound() {
    if (!isSoundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const beat = 0.11; // ヒロさんこだわりのテンポ感！

    // ====== 周波数（Hz）の定義 ======
    // メロディ・和音用
    const freqG4 = 392.00;    // ソ
    const freqE4 = 329.63;    // ミ
    const freqC5 = 523.25;    // 高いド
    // ベース用（新しく追加したの！）
    const freqE3 = 164.81;    // ミ（オクターブ下）
    const freqB2 = 123.47;    // 低いシ
    const freqC3 = 130.81;    // 低いド

    // ====== メロディ用のオシレーター ======
    const oscMelody = audioCtx.createOscillator();
    const gainMelody = audioCtx.createGain();
    oscMelody.type = 'triangle'; 
    oscMelody.connect(gainMelody);
    gainMelody.connect(audioCtx.destination);

    // ====== ベース用のオシレーター（新設！） ======
    const oscBass = audioCtx.createOscillator();
    const gainBass = audioCtx.createGain();
    // ベースがしっかり聞こえるように、少し太い音色（square: 矩形波）にしてみたの！
    oscBass.type = 'square'; 
    oscBass.connect(gainBass);
    gainBass.connect(audioCtx.destination);

    // ====== メロディラインのスケジューリング ======
    // 1拍目：●（ソ）
    oscMelody.frequency.setValueAtTime(freqG4, now);
    gainMelody.gain.setValueAtTime(0.15, now);
    gainMelody.gain.exponentialRampToValueAtTime(0.001, now + beat - 0.01);

    // 2拍目：○（休符）

    // 3拍目：●（ミ）
    oscMelody.frequency.setValueAtTime(freqE4, now + beat * 2);
    gainMelody.gain.setValueAtTime(0.15, now + beat * 2);
    gainMelody.gain.exponentialRampToValueAtTime(0.001, now + beat * 3 - 0.01);

    // 4拍目：●（ソ）
    oscMelody.frequency.setValueAtTime(freqG4, now + beat * 3);
    gainMelody.gain.setValueAtTime(0.15, now + beat * 3);
    gainMelody.gain.exponentialRampToValueAtTime(0.001, now + beat * 4 - 0.01);

    // ====== ベースラインのスケジューリング（ヒロさんの設計通りなの！） ======
    // 1拍目：●（ミ）
    oscBass.frequency.setValueAtTime(freqE3, now);
    gainBass.gain.setValueAtTime(0.05, now); // 矩形波は響くから音量控えめなの
    gainBass.gain.exponentialRampToValueAtTime(0.001, now + beat - 0.01);

    // 2拍目：○（休符）

    // 3〜4拍目：●_（低いシを伸ばす！）
    oscBass.frequency.setValueAtTime(freqB2, now + beat * 2);
    gainBass.gain.setValueAtTime(0.05, now + beat * 2);
    // 次の音まで切らずに伸ばすから、減衰のタイミングを遅らせるの！
    gainBass.gain.exponentialRampToValueAtTime(0.001, now + beat * 4 - 0.01);

    // ====== 最後のジャジャーン！（5拍目） ======
    const chordStartTime = now + beat * 4; 
    const stopTime = now + beat * 12;

    // メロディの「高いド」
    oscMelody.frequency.setValueAtTime(freqC5, chordStartTime);
    gainMelody.gain.setValueAtTime(0.12, chordStartTime); 
    gainMelody.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // ベースの「低いド」
    oscBass.frequency.setValueAtTime(freqC3, chordStartTime);
    gainBass.gain.setValueAtTime(0.06, chordStartTime); // ジャーン！の時は少しだけベースも強く！
    gainBass.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // 和音用の「下のミ (E4)」
    const oscChordE = audioCtx.createOscillator();
    const gainChordE = audioCtx.createGain();
    oscChordE.type = 'triangle';
    oscChordE.frequency.setValueAtTime(freqE4, chordStartTime);
    oscChordE.connect(gainChordE);
    gainChordE.connect(audioCtx.destination);
    gainChordE.gain.setValueAtTime(0.12, chordStartTime); 
    gainChordE.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // 和音用の「下のソ (G4)」
    const oscChordG = audioCtx.createOscillator();
    const gainChordG = audioCtx.createGain();
    oscChordG.type = 'triangle';
    oscChordG.frequency.setValueAtTime(freqG4, chordStartTime);
    oscChordG.connect(gainChordG);
    gainChordG.connect(audioCtx.destination);
    gainChordG.gain.setValueAtTime(0.12, chordStartTime); 
    gainChordG.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // ====== 発音のスタートとストップ ======
    oscMelody.start(now);
    oscBass.start(now);
    oscChordE.start(chordStartTime);
    oscChordG.start(chordStartTime);

    oscMelody.stop(stopTime);
    oscBass.stop(stopTime);
    oscChordE.stop(stopTime);
    oscChordG.stop(stopTime);
}

// ポインターが指しているテキストを更新する関数
function updatePointedText() {
    const targetX = 30;
    const targetY = 0;
    const pointAngle = Math.atan2(targetY, targetX);
    const normalizedAngleOffset = (angleOffset % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const adjustedAngle = (pointAngle - normalizedAngleOffset + 2 * Math.PI) % (2 * Math.PI);

    let currentAngle = 0;
    let foundText = "テキストエリアに、項目と倍率を書いて下さい。";

    const totalMultiplier = visibleTexts.reduce((acc, val) => acc + parseMultiplier(val), 0);

    visibleTexts.forEach(text => {
        const multiplier = parseMultiplier(text);
        const segmentAngle = (2 * Math.PI) * multiplier / totalMultiplier;

        if (adjustedAngle >= currentAngle && adjustedAngle < currentAngle + segmentAngle) {
            foundText = text.split('*')[0];
        }
        currentAngle += segmentAngle;
    });

    document.getElementById('pointedText').textContent = foundText;
}

// モーダルを表示する関数
function showModal(selectedText) {
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modalText');
    modal.style.display = 'block';
    modalText.textContent = selectedText;
    adjustFontSizeForModalText();
}

// モーダル上のテキストの大きさを調整する関数
// カードの幅（PCでは600px）に合わせて基準サイズを決めるので、スマホでもはみ出さないの
function adjustFontSizeForModalText() {
    const modalText = document.querySelector('.modal-text');
    const cardWidth = document.querySelector('.modal-content').clientWidth || 640;
    const maxModalContent = cardWidth * 0.89;
    const initialFontSize = Math.round(cardWidth * 0.117);
    modalText.style.fontSize = `${initialFontSize}px`;

    let fontSize = initialFontSize;
    while (modalText.scrollWidth > maxModalContent && fontSize > 10) {
        fontSize -= 1;
        modalText.style.fontSize = `${fontSize}px`;
    }
}

// モーダル上にテキストをオーバーレイ表示する関数
function displayTextOnModal(text) {
    let overlayText = document.getElementById('modalOverlayText');
    if (!overlayText) {
        overlayText = document.createElement('div');
        overlayText.id = 'modalOverlayText';
        document.querySelector('.modal-content').appendChild(overlayText);
    }
    overlayText.innerHTML = text;
}

// ====== 履歴表示を更新する関数ブロック ======
// 関数の主要な機能コメント：当選した順番を記憶したリストから、現在OFFになっている項目だけを抽出して履歴エリアに表示する関数なの！
function updateHistoryDisplay() {
    const historyContainer = document.getElementById('historyContainer');
    const historyList = document.getElementById('historyList');
    
    if (!historyList || !historyContainer) return; 
    
    historyList.innerHTML = '';

    // 履歴リストの中から、「現在OFFになっている」ものだけを抽出して表示するの！
    winningHistory.forEach(text => {
        if (segmentVisibility[text] === false) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'history-item';
            // *以降の倍率表示を消して、名前だけにするの
            itemDiv.textContent = '👑 ' + text.split('*')[0]; 
            historyList.appendChild(itemDiv);
        }
    });

    // 要素の追加（描画）が終わった直後に、コンテナのスクロール位置を一番下（scrollHeight）に合わせるの！
    historyContainer.scrollTop = historyContainer.scrollHeight;

}