import React, { useEffect, useRef, useState } from 'react';
import HanziWriter from 'hanzi-writer';
import { Eye, PenTool, RotateCcw, Volume2 } from 'lucide-react';
import { speakChinese, soundFx } from '../lib/audio';
import { ModalCloseButton, ModalShell } from './common/ModalShell';

interface HanziWriterModalProps {
  word: string;
  pinyin?: string;
  meaning?: string;
  onClose: () => void;
}

function extractHanziChars(text: string): string[] {
  return Array.from(text).filter((ch) => /[\u4e00-\u9fff]/.test(ch));
}

export const HanziWriterModal: React.FC<HanziWriterModalProps> = ({
  word,
  pinyin,
  meaning,
  onClose,
}) => {
  const chars = extractHanziChars(word);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<'animate' | 'quiz'>('quiz');
  const [statusMsg, setStatusMsg] = useState<string>('Tô theo các nét từ nét đầu tiên...');
  const [loadError, setLoadError] = useState<string | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<HanziWriter | null>(null);

  const activeChar = chars[selectedIdx] || chars[0] || '';

  useEffect(() => {
    if (!activeChar || !targetRef.current) return;
    targetRef.current.innerHTML = '';
    setLoadError(null);

    try {
      const isDark = document.documentElement.classList.contains('dark');
      const writer = HanziWriter.create(targetRef.current, activeChar, {
        width: 240,
        height: 240,
        padding: 12,
        showOutline: true,
        showCharacter: mode === 'animate',
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 250,
        strokeColor: isDark ? '#f8fafc' : '#111827',
        outlineColor: isDark ? '#334155' : '#e2e8f0',
        radicalColor: '#dc2626',
        highlightColor: '#f59e0b',
        drawingWidth: 18,
        onLoadCharDataError: () => {
          setLoadError('Không tải được dữ liệu nét chữ (cần kết nối mạng cho CDN hanzi-writer-data).');
        },
      });
      writerRef.current = writer;

      if (mode === 'animate') {
        setStatusMsg('Đang trình chiếu thứ tự nét viết...');
        writer.animateCharacter({
          onComplete: () => setStatusMsg('Hoàn tất thứ tự nét! Chuyển sang "Tập viết" để luyện.'),
        });
      } else {
        setStatusMsg('Kéo chuột / ngón tay để tô theo đúng thứ tự nét.');
        writer.quiz({
          onMistake: () => {
            soundFx.playWrong();
            setStatusMsg('Chưa đúng nét hoặc hướng viết — thử lại nhé!');
          },
          onCorrectStroke: (data) => {
            setStatusMsg(`Đúng rồi! Còn ${data.strokesRemaining} nét nữa.`);
          },
          onComplete: (summary) => {
            soundFx.playCorrect();
            setStatusMsg(
              `Tuyệt vời! Bạn đã viết xong chữ "${activeChar}" (sai ${summary.totalMistakes} lần).`
            );
          },
        });
      }
    } catch {
      setLoadError('Không khởi tạo được bảng tập viết chữ Hán.');
    }

    return () => {
      writerRef.current = null;
    };
  }, [activeChar, mode]);

  const handleReplay = () => {
    if (!writerRef.current) return;
    if (mode === 'animate') {
      setStatusMsg('Đang phát lại thứ tự nét...');
      writerRef.current.animateCharacter();
    } else {
      setMode('animate');
      setTimeout(() => setMode('quiz'), 10);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-md">
        <div className="p-5 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between bg-stone-50 dark:bg-slate-800/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="chinese-serif text-2xl font-bold text-gray-900 dark:text-white">{word}</span>
              {pinyin && <span className="text-sm font-mono text-red-600 dark:text-red-400 font-semibold">{pinyin}</span>}
              <button
                onClick={() => speakChinese(word)}
                className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 transition"
                title="Phát âm"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            {meaning && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{meaning}</p>}
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="p-6 flex flex-col items-center space-y-4">
          {chars.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {chars.map((ch, idx) => (
                <button
                  key={`${ch}-${idx}`}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-10 h-10 rounded-xl chinese-serif text-xl font-bold border transition ${
                    selectedIdx === idx
                      ? 'bg-red-600 text-white border-red-600 shadow-sm'
                      : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-800 dark:text-slate-200'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 bg-stone-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setMode('animate')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                mode === 'animate'
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400'
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> Xem nét viết
            </button>
            <button
              onClick={() => setMode('quiz')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                mode === 'quiz'
                  ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-gray-500 dark:text-slate-400'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" /> Tập tự viết
            </button>
          </div>

          <div className="relative rounded-2xl border-2 border-dashed border-stone-300 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-950 p-2">
            {/* Lưới chữ điền (Tian Zi Ge) */}
            <svg
              className="absolute inset-2 w-[240px] h-[240px] pointer-events-none opacity-30"
              viewBox="0 0 100 100"
            >
              <line x1="50" y1="0" x2="50" y2="100" stroke="#dc2626" strokeDasharray="3,3" strokeWidth="0.6" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="#dc2626" strokeDasharray="3,3" strokeWidth="0.6" />
              <line x1="0" y1="0" x2="100" y2="100" stroke="#94a3b8" strokeDasharray="2,2" strokeWidth="0.4" />
              <line x1="100" y1="0" x2="0" y2="100" stroke="#94a3b8" strokeDasharray="2,2" strokeWidth="0.4" />
            </svg>
            <div ref={targetRef} className="relative z-10 w-[240px] h-[240px]" />
          </div>

          {loadError ? (
            <p className="text-xs text-red-600 dark:text-red-400 text-center">{loadError}</p>
          ) : (
            <p className="text-xs text-gray-600 dark:text-slate-300 text-center min-h-[32px]">{statusMsg}</p>
          )}

          <button
            onClick={handleReplay}
            className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> {mode === 'animate' ? 'Xem lại' : 'Viết lại từ đầu'}
          </button>
        </div>
    </ModalShell>
  );
};
