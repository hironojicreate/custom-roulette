// ====== 変数定義ブロック ======
// キャンバス・ルーレット制御用のグローバル変数
const canvas = document.getElementById('diskCanvas');
const ctx = canvas.getContext('2d');
let radius = parseInt(document.getElementById('sizeSlider').value, 10);
// ポインターがはみ出す分を含めた、円盤まわりの余白
const POINTER_EXTENT = 85;
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
            const decoder = new TextDecoder('shift-jis');
            const text = decoder.decode(new Uint8Array(arrayBuffer));
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
function resizeCanvas() {
    canvas.width = 2 * (radius + POINTER_EXTENT);
    canvas.height = 2 * radius + 40;
    centerX = canvas.width / 2;
    centerY = radius + 20;
    // PCレイアウトでは、スタートボタンを円盤のすぐ下に置くの
    document.getElementById('toggleButton').style.top = `${canvas.height}px`;
}

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
        checkbox.onchange = () => {
            segmentVisibility[text] = checkbox.checked;
            saveCheckBoxState();
            recalculateSegmentsAndDraw();
            updateHistoryDisplay();
        };

        const label = document.createElement('label');
        label.appendChild(checkbox); // 1. まずチェックボックスをラベルの中に入れる
        label.appendChild(document.createTextNode(' ' + textWithoutMultiplier)); // 2. その隣に文字を入れる（見やすいように半角スペースを1つ挟むの！）
        wrapper.appendChild(label); // 3. 出来上がったラベルをラッパーに入れる

        checkBoxList.appendChild(wrapper);
    });
}

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
    let currentAngle = 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 5, 0, Math.PI * 2, false);
    ctx.fillStyle = '#adff2f';
    ctx.fill();

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;

    visibleTexts.forEach(text => {
        const multiplier = parseMultiplier(text);
        const segmentAngle = baseAngle * multiplier;
        const startAngle = currentAngle;
        const endAngle = currentAngle + segmentAngle;
        drawSegment(startAngle + angleOffset, endAngle + angleOffset, `hsl(${(currentAngle / (2 * Math.PI)) * 360}, 100%, 50%)`, text.split('*')[0].trim());
        currentAngle += segmentAngle;
    });

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

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

// 1つの扇型セグメントを描画する関数
function drawSegment(angleStart, angleEnd, color, text) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angleStart, angleEnd);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    drawSegmentLabel(text, angleStart, angleEnd);
}

// ====== 項目名の文字サイズ自動調整ブロック ======
const LABEL_FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", "Noto Sans JP", sans-serif';
const LABEL_FONT_WEIGHT = 'bold';
const LABEL_MIN_FONT = 10;           // これより小さくはしない（入り切らない分は「…」で省略）
const LABEL_MAX_FONT_RATIO = 0.24;   // 文字サイズの上限（半径に対する割合）
const LABEL_OUTER_RATIO = 0.9;       // 文字を置ける一番外側（半径に対する割合）
const LABEL_INNER_RATIO = 0.15;      // 文字を置ける一番内側（中心付近は狭いので避ける）
const labelWidthCache = new Map();   // 文字サイズ1pxあたりの文字幅のキャッシュ（毎フレーム測り直さないため）

function getLabelFont(fontSize) {
    return `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
}

// 文字サイズ1pxあたりの文字幅を返す関数（100pxで測って割る）
function getLabelWidthPerPx(text) {
    if (!labelWidthCache.has(text)) {
        ctx.font = getLabelFont(100);
        labelWidthCache.set(text, ctx.measureText(text).width / 100);
    }
    return labelWidthCache.get(text);
}

// 扇形の中に収まる、できるだけ大きな文字サイズで項目名を描く関数。
// 文字は中心から外側に向かって半径方向に並べるの。
//   ・扇形の幅：中心から距離 d の位置で使える高さは 2 × d × sin(扇形の角度 / 2)
//   ・半径方向の長さ：内側(INNER)〜外側(OUTER)の範囲に収める
// この2つを両方満たす最大の文字サイズを計算するの！
function drawSegmentLabel(text, angleStart, angleEnd) {
    if (!text) return;

    const segmentAngle = angleEnd - angleStart;
    const midAngle = (angleStart + angleEnd) / 2;
    const outer = radius * LABEL_OUTER_RATIO;
    const inner = radius * LABEL_INNER_RATIO;
    // 半分以上の大きさの扇形では、幅の制限は直径と同じ（sin は最大 1）
    const halfSin = Math.sin(Math.min(segmentAngle / 2, Math.PI / 2));
    const fillRatio = 0.85; // 扇形の幅いっぱいではなく、少し余白を残す
    const usableSin = halfSin * fillRatio;

    let label = text;
    let widthPerPx = getLabelWidthPerPx(label);

    // 文字の内側の端を d = outer - 文字幅 とすると、
    //   fontSize <= 2 × (outer - widthPerPx × fontSize) × usableSin
    //   → fontSize <= 2 × outer × usableSin / (1 + 2 × widthPerPx × usableSin)
    const calcFontSize = (wpp) => Math.min(
        radius * LABEL_MAX_FONT_RATIO,
        (2 * outer * usableSin) / (1 + 2 * wpp * usableSin),
        (outer - inner) / wpp
    );

    let fontSize = calcFontSize(widthPerPx);

    // 最小サイズでも入り切らない長い名前は、末尾を「…」にして縮めるの
    if (fontSize < LABEL_MIN_FONT) {
        fontSize = LABEL_MIN_FONT;
        const maxLength = Math.min(outer - inner, outer - LABEL_MIN_FONT / (2 * Math.max(usableSin, 0.0001)));
        while (label.length > 1 && widthPerPx * LABEL_MIN_FONT > maxLength) {
            label = label.slice(0, -1);
            widthPerPx = getLabelWidthPerPx(label + '…');
        }
        if (label !== text) label += '…';
    }

    // 扇形が細すぎて最小サイズの文字すら入らないときは描かない
    if (LABEL_MIN_FONT > 2 * outer * usableSin) return;

    // 文字を置ける範囲（幅の制限から決まる内側の限界〜外側）のちょうど真ん中に置くの
    const textWidth = widthPerPx * fontSize;
    const innerLimit = Math.max(inner, fontSize / (2 * Math.max(usableSin, 0.0001)));
    const textCenter = Math.min((innerLimit + outer) / 2, outer - textWidth / 2);

    ctx.save();
    // 扇形の影が文字にもかかってぼやけるのを防ぐの
    ctx.shadowColor = 'transparent';
    ctx.translate(centerX, centerY);
    ctx.rotate(midAngle);
    ctx.font = getLabelFont(fontSize);
    ctx.fillStyle = 'black';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, textCenter, 0);
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

    visibleTexts.forEach(text => {
        const multiplier = parseMultiplier(text);
        const totalMultiplier = visibleTexts.reduce((acc, val) => acc + parseMultiplier(val), 0);
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