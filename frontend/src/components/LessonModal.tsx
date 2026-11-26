import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { LessonMetaFields } from './common/LessonMetaFields';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';
import {
  downloadSampleExcel,
  downloadSampleJson,
  parseLessonImportFile,
  type ParsedLessonImport,
} from '../lib/lessonImport';
import type { LanguageCode, LessonDetail } from '../types';

interface LessonModalProps {
  lang?: LanguageCode;
  initialLesson?: LessonDetail | null;
  canCreateSystemLesson?: boolean;
  canCreateCustomLesson?: boolean;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    hskLevel: string;
    unit?: string;
    description?: string;
    vocabulary: any[];
    grammar: any[];
    isSystem?: boolean;
  }) => Promise<void>;
}

interface VocabRow {
  id?: string;
  hanzi: string;
  pinyin: string;
  sinoVietnamese?: string | null;
  meaning: string;
  type?: string | null;
  radical: string;
  breakdown: string;
  mnemonic?: string | null;
  example: string;
  examplePinyin?: string | null;
  exampleMeaning?: string | null;
}

interface GrammarRow {
  id?: string;
  title: string;
  formula: string;
  explanation: string;
  notes?: string | null;
  examples?: any[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const LessonModal: React.FC<LessonModalProps> = ({
  lang = 'zh',
  initialLesson,
  canCreateSystemLesson = false,
  canCreateCustomLesson = true,
  onClose,
  onSave,
}) => {
  const isEnglish = lang === 'en';
  const defaultLevel = isEnglish ? 'CEFR A1' : 'HSK 1';
  const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
  const [title, setTitle] = useState(initialLesson?.title || '');
  const [hskLevel, setHskLevel] = useState(initialLesson?.hskLevel || defaultLevel);
  const [description, setDescription] = useState(initialLesson?.description || '');
  const [createAsSystem, setCreateAsSystem] = useState<boolean>(
    Boolean(initialLesson ? initialLesson.isSystem : !canCreateCustomLesson && canCreateSystemLesson)
  );
  const [vocabRows, setVocabRows] = useState<VocabRow[]>(
    initialLesson?.vocabulary?.length
      ? initialLesson.vocabulary.map((v) => ({
          id: v.id,
          hanzi: v.hanzi,
          pinyin: v.pinyin,
          sinoVietnamese: v.sinoVietnamese ?? null,
          meaning: v.meaning,
          type: v.type ?? null,
          radical: v.radical || '',
          breakdown: v.breakdown || '',
          mnemonic: v.mnemonic ?? null,
          example: v.example || '',
          examplePinyin: v.examplePinyin ?? null,
          exampleMeaning: v.exampleMeaning ?? null,
        }))
      : [
          { hanzi: '', pinyin: '', meaning: '', radical: '', breakdown: '', example: '' },
          { hanzi: '', pinyin: '', meaning: '', radical: '', breakdown: '', example: '' },
        ]
  );
  const [grammarRows, setGrammarRows] = useState<GrammarRow[]>(
    initialLesson?.grammar?.length
      ? initialLesson.grammar.map((g) => ({
          id: g.id,
          title: g.title,
          formula: g.formula || '',
          explanation: g.explanation || '',
          notes: g.notes ?? null,
          examples: g.examples || [],
        }))
      : [{ title: '', formula: '', explanation: '' }]
  );
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // State cho tab Import (giống mẫu kéo thả + Kiểm tra -> Xác nhận lưu)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const [checkedImport, setCheckedImport] = useState<ParsedLessonImport | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const [importLevel, setImportLevel] = useState('HSK 1');
  const [importDesc, setImportDesc] = useState('');
  const isEditMode = Boolean(initialLesson);
  // Khi chỉnh sửa: 'merge' = gộp thêm vào bài hiện có, 'replace' = thay thế toàn bộ
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFile = (file: File | null) => {
    setSelectedFile(file);
    setCheckedImport(null);
    setError(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) handleSelectFile(file);
    e.target.value = '';
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] || null;
    if (file) handleSelectFile(file);
  };

  const handleCheckFile = async () => {
    if (!selectedFile) return;
    setError(null);
    setCheckingFile(true);
    try {
      const result = await parseLessonImportFile(selectedFile);
      if (!result.ok) {
        setCheckedImport(null);
        setError(result.error);
        return;
      }
      setCheckedImport(result.data);
      if (isEditMode) {
        // Giữ thông tin bài đang sửa, chỉ lấy từ file nếu bài đang để trống
        setImportTitle(title || result.data.title);
        setImportLevel(hskLevel || result.data.hskLevel);
        setImportDesc(description || result.data.description);
      } else {
        setImportTitle(result.data.title);
        setImportLevel(result.data.hskLevel);
        setImportDesc(result.data.description);
      }
    } finally {
      setCheckingFile(false);
    }
  };

  /** Tính danh sách từ vựng / ngữ pháp sau khi áp dụng file import (gộp hoặc thay thế). */
  const buildImportedRows = (data: ParsedLessonImport): { vocab: VocabRow[]; grammar: GrammarRow[] } => {
    const importedVocab: VocabRow[] = data.vocabulary.map((v) => ({
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      meaning: v.meaning,
      radical: v.radical,
      breakdown: v.breakdown,
      example: v.example,
    }));
    const importedGrammar: GrammarRow[] = data.grammar.map((g) => ({
      title: g.title,
      formula: g.formula,
      explanation: g.explanation,
    }));

    const currentVocab = vocabRows.filter((r) => r.hanzi.trim() || r.meaning.trim());
    const currentGrammar = grammarRows.filter((g) => g.title.trim());

    if (!isEditMode || importMode === 'replace') {
      return {
        vocab: importedVocab.length > 0 ? importedVocab : currentVocab,
        grammar: importedGrammar.length > 0 ? importedGrammar : currentGrammar,
      };
    }

    // Gộp: từ trùng Hán tự thì cập nhật theo file, từ mới thì thêm vào cuối
    const mergedVocab = [...currentVocab];
    for (const item of importedVocab) {
      const idx = mergedVocab.findIndex((r) => r.hanzi.trim() === item.hanzi.trim());
      if (idx >= 0) {
        const old = mergedVocab[idx];
        mergedVocab[idx] = {
          ...old,
          hanzi: item.hanzi,
          pinyin: item.pinyin || old.pinyin,
          meaning: item.meaning || old.meaning,
          radical: item.radical || old.radical,
          breakdown: item.breakdown || old.breakdown,
          example: item.example || old.example,
        };
      } else {
        mergedVocab.push(item);
      }
    }

    const mergedGrammar = [...currentGrammar];
    for (const g of importedGrammar) {
      const idx = mergedGrammar.findIndex((r) => r.title.trim() === g.title.trim());
      if (idx >= 0) {
        const old = mergedGrammar[idx];
        mergedGrammar[idx] = {
          ...old,
          title: g.title,
          formula: g.formula || old.formula,
          explanation: g.explanation || old.explanation,
        };
      } else {
        mergedGrammar.push(g);
      }
    }

    return { vocab: mergedVocab, grammar: mergedGrammar };
  };

  const importSummary = (() => {
    if (!checkedImport || !isEditMode) return null;
    const currentHanzi = new Set(vocabRows.map((r) => r.hanzi.trim()).filter(Boolean));
    const duplicated = checkedImport.vocabulary.filter((v) => currentHanzi.has(v.hanzi.trim())).length;
    const result = buildImportedRows(checkedImport);
    return {
      currentCount: currentHanzi.size,
      newCount: checkedImport.vocabulary.length - duplicated,
      duplicated,
      finalCount: result.vocab.length,
      finalGrammar: result.grammar.length,
    };
  })();

  const handleMoveImportToManual = () => {
    if (!checkedImport) return;
    const { vocab, grammar } = buildImportedRows(checkedImport);
    setTitle(importTitle || checkedImport.title);
    setHskLevel(importLevel || checkedImport.hskLevel);
    setDescription(importDesc);
    setVocabRows(vocab.length > 0 ? vocab : vocabRows);
    setGrammarRows(grammar.length > 0 ? grammar : grammarRows);
    setError(null);
    setActiveTab('manual');
  };

  const handleSaveImportedLesson = async () => {
    if (!checkedImport) return;
    const finalTitle = importTitle.trim();
    if (!finalTitle) {
      setError('Tên buổi học không được để trống.');
      return;
    }
    const { vocab, grammar } = buildImportedRows(checkedImport);
    setError(null);
    setSaving(true);
    try {
      await onSave({
        title: finalTitle,
        hskLevel: importLevel || 'HSK 1',
        unit: checkedImport.unit,
        description: importDesc,
        vocabulary: isEditMode
          ? vocab.filter((v) => v.hanzi.trim() && v.meaning.trim())
          : checkedImport.vocabulary,
        grammar: isEditMode ? grammar.filter((g) => g.title.trim()) : checkedImport.grammar,
        isSystem: initialLesson ? initialLesson.isSystem : createAsSystem,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPaste = () => {
    const parsed: VocabRow[] = [];
    pasteText.split('\n').forEach((line) => {
      if (!line.trim()) return;
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length >= 2) {
        parsed.push({
          hanzi: parts[0] || '',
          pinyin: parts[1] || '',
          meaning: parts[2] || '',
          radical: parts[3] || '',
          breakdown: parts[4] || '',
          example: parts[5] || '',
        });
      }
    });
    if (parsed.length > 0) {
      setVocabRows((prev) => [...prev.filter((r) => r.hanzi || r.meaning), ...parsed]);
      setPasteText('');
      setShowPasteBox(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        title,
        hskLevel,
        description,
        vocabulary: vocabRows.filter((v) => v.hanzi.trim() && v.meaning.trim()),
        grammar: grammarRows.filter((g) => g.title.trim()),
        isSystem: initialLesson ? initialLesson.isSystem : createAsSystem,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} closeDisabled={saving} maxWidthClass="max-w-4xl" flexColumn>
        <div className="p-5 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {initialLesson ? 'Chỉnh sửa buổi học' : 'Thêm buổi học mới'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Hệ thống tự động sinh câu hỏi trắc nghiệm (có đáp án nhiễu thông minh), xếp câu & dịch câu.
              </p>
            </div>
          </div>
          <ModalCloseButton onClick={onClose} disabled={saving} />
        </div>

        <div className="px-6 py-2.5 bg-stone-100/80 dark:bg-slate-950/60 border-b border-stone-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setActiveTab('manual');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'manual'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-700'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Nhập thủ công
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setActiveTab('import');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'import'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-700'
              }`}
            >
              <Upload className="w-3.5 h-3.5" /> Import buổi học
            </button>
          </div>

          {initialLesson ? (
            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                initialLesson.isSystem
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                  : 'bg-stone-200 dark:bg-slate-800 text-gray-700 dark:text-slate-300'
              }`}
            >
              {initialLesson.isSystem ? 'Bài học hệ thống (HSK)' : 'Bài học tự tạo'}
            </span>
          ) : (
            canCreateSystemLesson && (
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createAsSystem}
                  disabled={!canCreateCustomLesson}
                  onChange={(e) => setCreateAsSystem(e.target.checked)}
                  className="rounded border-amber-400 text-red-600 focus:ring-red-500"
                />
                <span>Lưu làm bài học hệ thống (công khai cho mọi học viên)</span>
              </label>
            )
          )}
        </div>

        {activeTab === 'manual' ? (
          <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6 flex-grow">
            <LessonMetaFields
              lang={lang}
              title={title}
              hskLevel={hskLevel}
              description={description}
              onChangeTitle={setTitle}
              onChangeLevel={setHskLevel}
              onChangeDescription={setDescription}
              titleRequired
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                  Từ vựng ({vocabRows.length})
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPasteBox((s) => !s)}
                    className="text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 flex items-center gap-1"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" /> Dán nhanh nhiều từ
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setVocabRows((r) => [
                        ...r,
                        { hanzi: '', pinyin: '', meaning: '', radical: '', breakdown: '', example: '' },
                      ])
                    }
                    className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm từ
                  </button>
                </div>
              </div>

              {showPasteBox && (
                <div className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 space-y-2">
                  <p className="text-[11px] text-purple-800 dark:text-purple-200">
                    Mỗi dòng 1 từ theo định dạng: <code>Hán tự | Pinyin | Nghĩa | Bộ thủ | Cấu tạo</code>
                  </p>
                  <textarea
                    rows={4}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={'你好 | nǐ hǎo | Xin chào | 亻 Nhân đứng | ...'}
                    className="w-full p-2 text-xs rounded-lg border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={handleApplyPaste}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold"
                  >
                    Chèn vào danh sách
                  </button>
                </div>
              )}

              <div className="space-y-2.5">
                {vocabRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-2xl border border-stone-200 dark:border-slate-700 bg-stone-50/60 dark:bg-slate-800/40 grid grid-cols-1 md:grid-cols-6 gap-2 items-center"
                  >
                    <input
                      placeholder={isEnglish ? 'Từ tiếng Anh *' : 'Hán tự *'}
                      value={row.hanzi}
                      onChange={(e) =>
                        setVocabRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, hanzi: e.target.value } : item))
                        )
                      }
                      className={`p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold ${
                        isEnglish ? '' : 'chinese-font'
                      }`}
                    />
                    <input
                      placeholder={isEnglish ? 'Phiên âm IPA' : 'Pinyin'}
                      value={row.pinyin}
                      onChange={(e) =>
                        setVocabRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, pinyin: e.target.value } : item))
                        )
                      }
                      className="p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                    <input
                      placeholder="Nghĩa tiếng Việt *"
                      value={row.meaning}
                      onChange={(e) =>
                        setVocabRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, meaning: e.target.value } : item))
                        )
                      }
                      className="p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 md:col-span-2"
                    />
                    <input
                      placeholder={isEnglish ? 'Word family / Mẹo' : 'Bộ thủ / Mẹo'}
                      value={row.radical}
                      onChange={(e) =>
                        setVocabRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, radical: e.target.value } : item))
                        )
                      }
                      className="p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => setVocabRows((list) => list.filter((_, i) => i !== idx))}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg justify-self-end"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                  Ngữ pháp ({grammarRows.length})
                </h4>
                <button
                  type="button"
                  onClick={() => setGrammarRows((g) => [...g, { title: '', formula: '', explanation: '' }])}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm cấu trúc
                </button>
              </div>

              {grammarRows.map((g, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-2xl border border-stone-200 dark:border-slate-700 bg-stone-50/60 dark:bg-slate-800/40 space-y-2"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      placeholder="Tên cấu trúc (vd: Câu chữ 是)"
                      value={g.title}
                      onChange={(e) =>
                        setGrammarRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item))
                        )
                      }
                      className="p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                    <input
                      placeholder="Công thức (vd: A + 是 + B)"
                      value={g.formula}
                      onChange={(e) =>
                        setGrammarRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, formula: e.target.value } : item))
                        )
                      }
                      className="p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Giải thích ngắn..."
                      value={g.explanation}
                      onChange={(e) =>
                        setGrammarRows((list) =>
                          list.map((item, i) => (i === idx ? { ...item, explanation: e.target.value } : item))
                        )
                      }
                      className="flex-grow p-2 text-xs rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => setGrammarRows((list) => list.filter((_, i) => i !== idx))}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <ErrorBanner message={error} />

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-bold text-gray-700 dark:text-slate-300"
              >
                Huỷ bỏ
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md"
              >
                <Save className="w-4 h-4" /> {saving ? 'Đang lưu...' : 'Lưu buổi học'}
              </button>
            </div>
          </form>
        ) : (
          <div className="overflow-y-auto p-6 space-y-5 flex-grow">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">
                Tải file mẫu chuẩn để điền nội dung buổi học:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadSampleExcel}
                  className="px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" /> Mẫu Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={downloadSampleJson}
                  className="px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1.5 transition"
                >
                  <FileCode2 className="w-3.5 h-3.5" /> Mẫu JSON (.json)
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.xlsx,.xls"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDropFile}
              className={`rounded-2xl border-2 border-dashed py-12 px-6 text-center cursor-pointer transition select-none ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-emerald-600/40 dark:border-emerald-500/40 bg-emerald-50/20 dark:bg-slate-800/30 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex flex-col items-center justify-center gap-2.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  {selectedFile?.name.toLowerCase().endsWith('.json') ? (
                    <FileCode2 className="w-5 h-5" />
                  ) : selectedFile ? (
                    <FileSpreadsheet className="w-5 h-5" />
                  ) : (
                    <Upload className="w-5 h-5" />
                  )}
                </div>

                {selectedFile ? (
                  <>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {selectedFile.name}{' '}
                      <span className="font-mono text-xs font-normal text-gray-500 dark:text-slate-400">
                        ({formatFileSize(selectedFile.size)})
                      </span>
                    </p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                        Bấm để chọn file khác hoặc kéo thả file mới vào đây
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectFile(null);
                        }}
                        className="px-2 py-0.5 rounded-md bg-stone-200 dark:bg-slate-700 hover:bg-stone-300 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 font-semibold"
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      Kéo thả file vào đây hoặc bấm để chọn file
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      Định dạng .json, .xlsx, .xls, dung lượng tối đa 5MB
                    </p>
                  </>
                )}
              </div>
            </div>

            <ErrorBanner message={error} />

            {checkedImport && (
              <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    Kiểm tra hợp lệ ({checkedImport.detectedFormat})
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-bold">
                    <span className="px-2.5 py-0.5 rounded-full bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-stone-200 dark:border-slate-700">
                      {checkedImport.vocabulary.length} từ vựng
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-stone-200 dark:border-slate-700">
                      {checkedImport.grammar.length} ngữ pháp
                    </span>
                  </div>
                </div>

                {checkedImport.warnings && checkedImport.warnings.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
                    {checkedImport.warnings.join(' ')}
                  </div>
                )}

                {isEditMode && importSummary && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-gray-700 dark:text-slate-300">
                      Cách áp dụng vào buổi học đang sửa
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setImportMode('merge')}
                        className={`p-3 rounded-xl border text-left transition ${
                          importMode === 'merge'
                            ? 'border-emerald-500 bg-white dark:bg-slate-800 ring-2 ring-emerald-500/30'
                            : 'border-stone-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 hover:border-emerald-400'
                        }`}
                      >
                        <span className="block text-xs font-bold text-gray-900 dark:text-white">
                          Gộp thêm vào bài hiện có
                        </span>
                        <span className="block text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                          Giữ {importSummary.currentCount} từ cũ, thêm {importSummary.newCount} từ mới, cập nhật{' '}
                          {importSummary.duplicated} từ trùng Hán tự.
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportMode('replace')}
                        className={`p-3 rounded-xl border text-left transition ${
                          importMode === 'replace'
                            ? 'border-red-500 bg-white dark:bg-slate-800 ring-2 ring-red-500/30'
                            : 'border-stone-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 hover:border-red-400'
                        }`}
                      >
                        <span className="block text-xs font-bold text-gray-900 dark:text-white">
                          Thay thế toàn bộ
                        </span>
                        <span className="block text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                          Xoá {importSummary.currentCount} từ cũ, dùng {checkedImport.vocabulary.length} từ trong file.
                        </span>
                      </button>
                    </div>
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold">
                      Sau khi áp dụng: {importSummary.finalCount} từ vựng, {importSummary.finalGrammar} ngữ pháp.
                    </p>
                  </div>
                )}

                <LessonMetaFields
                  title={importTitle}
                  hskLevel={importLevel}
                  description={importDesc}
                  onChangeTitle={setImportTitle}
                  onChangeLevel={setImportLevel}
                  onChangeDescription={setImportDesc}
                  compact
                />

                {checkedImport.vocabulary.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 divide-y divide-stone-100 dark:divide-slate-800">
                    {checkedImport.vocabulary.slice(0, 12).map((v, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="chinese-font font-bold text-gray-900 dark:text-white">{v.hanzi}</span>
                          {v.pinyin && <span className="font-mono text-red-600 dark:text-red-400">{v.pinyin}</span>}
                        </div>
                        <span className="text-gray-600 dark:text-slate-300 truncate">{v.meaning}</span>
                      </div>
                    ))}
                    {checkedImport.vocabulary.length > 12 && (
                      <div className="px-3 py-1.5 text-[11px] text-center text-gray-500 dark:text-slate-400">
                        ... và {checkedImport.vocabulary.length - 12} từ nữa
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 flex-wrap pt-2 border-t border-stone-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-300 transition"
              >
                Huỷ
              </button>
              {!checkedImport ? (
                <button
                  type="button"
                  disabled={!selectedFile || checkingFile}
                  onClick={handleCheckFile}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
                >
                  {checkingFile ? 'Đang kiểm tra...' : 'Kiểm tra'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleMoveImportToManual}
                    className="px-4 py-2 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-bold text-blue-700 dark:text-blue-300 inline-flex items-center gap-1.5 transition"
                  >
                    {isEditMode ? 'Áp dụng & chỉnh tiếp' : 'Chuyển sang tab thủ công'}{' '}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveImportedLesson}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md transition"
                  >
                    <Save className="w-4 h-4" />{' '}
                    {saving ? 'Đang lưu...' : isEditMode ? 'Lưu thay đổi' : 'Lưu buổi học'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
    </ModalShell>
  );
};
