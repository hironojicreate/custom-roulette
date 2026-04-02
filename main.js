// ====== 変数定義ブロック ======
// キャンバス・ルーレット制御用のグローバル変数
const canvas = document.getElementById('diskCanvas');
const ctx = canvas.getContext('2d');
let radius = parseInt(document.getElementById('sizeSlider').value, 10);
const centerX = canvas.width / 2;
let centerY = radius + 20;
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

// スクリーンショット用のフラグ
let shiftPressed = false;
let sPressed = false;
let rPressed = false;

// 音声・設定用の変数
let audioCtx;
let lastPointedText = "";
let isSoundEnabled = false;
let isAutoDisableEnabled = false;
let lastTick = -1;

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

    // 6. 初期描画
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
});


// ====== UI・イベントリスナーブロック ======

// ファイルドラッグ＆ドロップ（CSV読み込み）
const inputArea = document.getElementById('inputArea');
inputArea.addEventListener('dragover', (event) => event.preventDefault());
inputArea.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];

    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
        alert('CSVファイルをドロップしてください。');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const arrayBuffer = event.target.result;
            const decoder = new TextDecoder('shift-jis');
            const text = decoder.decode(new Uint8Array(arrayBuffer));
            const formattedText = text.split(',').join('\n');
            inputArea.value = formattedText;

            texts = document.getElementById('inputArea').value.trim().split('\n').filter(line => line.trim() !== "");
            updateCheckBoxList();
            recalculateSegmentsAndDraw();
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
    texts = inputValue.split('\n').filter(line => line.trim() !== "");

    if (texts.length === 0) segmentVisibility = {};

    updateCheckBoxList();
    saveCheckBoxState();
    recalculateSegmentsAndDraw();
});

// サイズスライダーの変更
document.getElementById('sizeSlider').addEventListener('input', function () {
    radius = parseInt(this.value, 10);
    centerY = radius + 20;
    recalculateSegmentsAndDraw();
    const topYPosition = centerY + radius + 20;
    document.getElementById('toggleButton').style.top = `calc(${topYPosition}px)`;
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
    document.getElementById('inputArea').value = 'りんご\nみかん*0.5\nいちご\nバナナ*2';
    texts = document.getElementById('inputArea').value.trim().split('\n');
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
});

// 項目全削除ボタン
document.getElementById('clearInputButton').addEventListener('click', function () {
    document.getElementById('inputArea').value = '';
    texts = [];
    segmentVisibility = {};
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
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

    const randomizedText = itemsWithMultipliers.map(({ item, multiplier }) => multiplier ? `${item}*${multiplier}` : item).join('\n');
    document.getElementById('inputArea').value = randomizedText;
    texts = randomizedText.split('\n');
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
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
        "・項目の後ろに「*数字」と入力すると倍率を指定できます。",
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

    // 追加: ブラウザの音声再生制限を解除するために、初回クリック時にAudioContextを準備するの！
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
    saveCheckBoxState();
    updateCheckBoxList();
    recalculateSegmentsAndDraw();
});

document.getElementById('uncheckAllBtn').addEventListener('click', function () {
    // 全ての項目の状態を false (非表示) にする
    texts.forEach(text => {
        segmentVisibility[text] = false;
    });
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
function parseMultiplier(text) {
    const parts = text.split('*');
    return parts.length === 2 && !isNaN(parts[1]) ? parseFloat(parts[1]) : 1;
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
    const deltaTime = now - lastUpdateTime;

    if (spinning) {
        spinSpeed = Math.min(spinSpeed + spinAcceleration, maxSpinSpeed);
    } else {
        spinSpeed *= inertiaDecay;

        if (spinSpeed <= 0.00005) {
            spinSpeed = 0;
            toggleButton.textContent = "スタート";
            toggleButton.className = 'button startButton';
            toggleButton.disabled = false;
            randomizeButton.disabled = false;
            clearInputButton.disabled = false;

            const winningText = document.getElementById('pointedText').textContent;

            playResultSound();

            if (isAutoDisableEnabled && visibleTexts.length > 0) {
                // 元のテキストフォーマット（名前*倍率）を検索してOFFにする
                const originalText = texts.find(t => t.split('*')[0] === winningText);
                if (originalText) {
                    segmentVisibility[originalText] = false;
                    saveCheckBoxState();
                    updateCheckBoxList();
                    recalculateSegmentsAndDraw();
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
        drawSegment(startAngle + angleOffset, endAngle + angleOffset, `hsl(${(currentAngle / (2 * Math.PI)) * 360}, 100%, 50%)`, text.split('*')[0]);
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

    const midAngle = (angleStart + angleEnd) / 2;
    const textRadius = radius * 0.6;
    const textX = centerX + textRadius * Math.cos(midAngle);
    const textY = centerY + textRadius * Math.sin(midAngle);

    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, textX, textY);
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
function adjustFontSizeForModalText() {
    const modalText = document.querySelector('.modal-text');
    const maxModalContent = 570;
    const initialFontSize = 75;
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

