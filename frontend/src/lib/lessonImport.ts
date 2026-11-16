import * as XLSXNamespace from 'xlsx-js-style';
import { HSK_LEVELS } from './constants';

const XLSX: typeof XLSXNamespace = (XLSXNamespace as any).default || XLSXNamespace;

export interface ImportedVocabItem {
  hanzi: string;
  pinyin: string;
  meaning: string;
  radical: string;
  breakdown: string;
  example: string;
  sinoVietnamese?: string;
  type?: string;
  mnemonic?: string;
  examplePinyin?: string;
  exampleMeaning?: string;
}

export interface ImportedGrammarItem {
  title: string;
  formula: string;
  explanation: string;
  notes?: string;
  examples?: Array<{ hanzi: string; pinyin: string; meaning: string }>;
}

export interface ParsedLessonImport {
  title: string;
  hskLevel: string;
  unit?: string;
  description: string;
  vocabulary: ImportedVocabItem[];
  grammar: ImportedGrammarItem[];
  detectedFormat: 'JSON' | 'Excel (.xlsx/.xls)' | 'CSV/TSV' | 'Văn bản có cấu trúc';
  warnings?: string[];
}

export type ParseImportResult =
  | { ok: true; data: ParsedLessonImport }
  | { ok: false; error: string };

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_LEVELS = new Set<string>(HSK_LEVELS);

function normalizeLevel(raw?: string): string {
  if (!raw) return 'HSK 1';
  const trimmed = String(raw).trim();
  if (ALLOWED_LEVELS.has(trimmed)) return trimmed;
  const m = trimmed.match(/hsk\s*([1-4])/i);
  if (m) return `HSK ${m[1]}`;
  if (/giao\s*ti[eêế]p/i.test(trimmed)) return 'Giao tiếp';
  return 'HSK 1';
}

function normalizeHeaderKey(key: string): string {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickField(obj: Record<string, any>, aliases: string[]): string {
  const normalizedMap = new Map<string, any>();
  for (const [k, v] of Object.entries(obj)) {
    normalizedMap.set(normalizeHeaderKey(k), v);
  }
  for (const alias of aliases) {
    const val = normalizedMap.get(alias);
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function normalizeVocabObj(raw: any): ImportedVocabItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const hanzi = pickField(raw, ['hanzi', 'chuhan', 'hantu', 'tumoi', 'tu', 'word', 'chinese']);
  const meaning = pickField(raw, [
    'meaning',
    'nghiatiengviet',
    'nghia',
    'vietnamese',
    'vn',
    'dich',
  ]);
  if (!hanzi || !meaning) return null;

  return {
    hanzi,
    pinyin: pickField(raw, ['pinyin', 'phienam']),
    meaning,
    radical: pickField(raw, ['radical', 'bothu', 'meo', 'bothumeo']),
    breakdown: pickField(raw, ['breakdown', 'cautao']),
    example: pickField(raw, ['example', 'vidu', 'caumau', 'examplehanzi']),
    sinoVietnamese: pickField(raw, ['sinovietnamese', 'hanviet', 'amhanviet']) || undefined,
    type: pickField(raw, ['type', 'wordtype', 'tuloai']) || undefined,
    mnemonic: pickField(raw, ['mnemonic', 'meonho']) || undefined,
    examplePinyin: pickField(raw, ['examplepinyin', 'vidupinyin']) || undefined,
    exampleMeaning: pickField(raw, ['examplemeaning', 'vidunghia']) || undefined,
  };
}

function normalizeGrammarObj(raw: any): ImportedGrammarItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = pickField(raw, ['title', 'name', 'tencautruc', 'ten', 'nguphap']);
  if (!title) return null;
  return {
    title,
    formula: pickField(raw, ['formula', 'structure', 'congthuc', 'cautruc']),
    explanation: pickField(raw, ['explanation', 'giaithich', 'mota']),
    notes: pickField(raw, ['notes', 'ghichu']) || undefined,
    examples: Array.isArray(raw.examples) ? raw.examples : undefined,
  };
}

export function parseLessonJsonText(rawInput: string, fallbackTitle = ''): ParseImportResult {
  const text = rawInput.replace(/^\uFEFF/, '').trim();
  if (!text) {
    return { ok: false, error: 'File JSON trống, không có dữ liệu để kiểm tra.' };
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const vocabulary = parsed.map(normalizeVocabObj).filter((v): v is ImportedVocabItem => v !== null);
      if (vocabulary.length === 0) {
        return {
          ok: false,
          error: 'Mảng JSON không có từ vựng hợp lệ (mỗi phần tử cần có "hanzi" và "meaning").',
        };
      }
      return {
        ok: true,
        data: {
          title: fallbackTitle || 'Buổi học import từ JSON',
          hskLevel: 'HSK 1',
          description: `Import ${vocabulary.length} từ vựng từ JSON`,
          vocabulary,
          grammar: [],
          detectedFormat: 'JSON',
        },
      };
    }

    if (parsed && typeof parsed === 'object') {
      const rawVocab = Array.isArray(parsed.vocabulary)
        ? parsed.vocabulary
        : Array.isArray(parsed.vocab)
        ? parsed.vocab
        : [];
      const rawGrammar = Array.isArray(parsed.grammar) ? parsed.grammar : [];
      const vocabulary = rawVocab.map(normalizeVocabObj).filter((v: any): v is ImportedVocabItem => v !== null);
      const grammar = rawGrammar.map(normalizeGrammarObj).filter((g: any): g is ImportedGrammarItem => g !== null);

      const warnings: string[] = [];
      if (rawVocab.length > vocabulary.length) {
        warnings.push(`Bỏ qua ${rawVocab.length - vocabulary.length} dòng từ vựng thiếu Hán tự hoặc Nghĩa.`);
      }

      if (vocabulary.length === 0 && grammar.length === 0) {
        return {
          ok: false,
          error: 'File JSON cần có mảng "vocabulary" (mỗi từ gồm "hanzi", "meaning") hoặc "grammar".',
        };
      }

      return {
        ok: true,
        data: {
          title: String(parsed.title || fallbackTitle || 'Buổi học import từ JSON').trim(),
          hskLevel: normalizeLevel(parsed.hskLevel || parsed.level),
          unit: parsed.unit ? String(parsed.unit).trim() : undefined,
          description: String(parsed.description || '').trim(),
          vocabulary,
          grammar,
          detectedFormat: 'JSON',
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    }

    return { ok: false, error: 'Cấu trúc JSON phải là object buổi học hoặc mảng từ vựng.' };
  } catch (err) {
    return {
      ok: false,
      error: `JSON không hợp lệ: ${(err as Error).message}`,
    };
  }
}

export function parseLessonExcelBuffer(buffer: ArrayBuffer, fallbackTitle = ''): ParseImportResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { ok: false, error: 'File Excel không có sheet dữ liệu nào.' };
    }

    const sheetByKey = new Map<string, string>();
    for (const name of workbook.SheetNames) {
      sheetByKey.set(normalizeHeaderKey(name), name);
    }

    let title = fallbackTitle;
    let hskLevel = 'HSK 1';
    let unit: string | undefined;
    let description = '';

    // Bỏ qua sheet hướng dẫn ("Huong dan")
    const guideSheetName = sheetByKey.get('huongdan') || sheetByKey.get('guide') || sheetByKey.get('instructions');

    // 1. Tương thích nếu có sheet ThongTin / Info riêng
    const infoSheetName =
      sheetByKey.get('thongtin') ||
      sheetByKey.get('info') ||
      sheetByKey.get('buoihoc') ||
      sheetByKey.get('lesson');
    if (infoSheetName) {
      const infoSheet = workbook.Sheets[infoSheetName];
      const kvRows = XLSX.utils.sheet_to_json<Record<string, any>>(infoSheet, { defval: '' });
      for (const row of kvRows) {
        const keyCol = pickField(row, ['truong', 'field', 'key', 'muc', 'thuoctinh']);
        const valCol = pickField(row, ['giatri', 'value', 'noidung']);
        if (keyCol && valCol) {
          const nk = normalizeHeaderKey(keyCol);
          if (/^(title|tenbuoihoc|tenbaihoc|ten)$/.test(nk)) title = valCol;
          else if (/^(hsklevel|capdo|level|hsk)$/.test(nk)) hskLevel = normalizeLevel(valCol);
          else if (/^(description|mota|motatomtat)$/.test(nk)) description = valCol;
          else if (/^(unit|donnguyen)$/.test(nk)) unit = valCol;
        } else {
          const t = pickField(row, ['title', 'tenbuoihoc', 'tenbaihoc']);
          const lvl = pickField(row, ['hsklevel', 'capdo', 'level']);
          const desc = pickField(row, ['description', 'mota', 'motatomtat']);
          const un = pickField(row, ['unit', 'donnguyen']);
          if (t) title = t;
          if (lvl) hskLevel = normalizeLevel(lvl);
          if (desc) description = desc;
          if (un) unit = un;
        }
      }
    }

    // 2. Sheet Tu vung (bỏ qua Huong dan & Ngu phap)
    const vocabSheetName =
      sheetByKey.get('tuvung') ||
      sheetByKey.get('vocabulary') ||
      sheetByKey.get('vocab') ||
      workbook.SheetNames.find((n) => {
        const nk = normalizeHeaderKey(n);
        return n !== infoSheetName && n !== guideSheetName && nk !== 'nguphap' && nk !== 'grammar';
      });

    const vocabulary: ImportedVocabItem[] = [];
    const warnings: string[] = [];

    if (vocabSheetName) {
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[vocabSheetName], {
        defval: '',
      });
      let skipped = 0;
      let lastGroupTitle = '';
      let lastGroupLevel = '';
      let lastGroupDesc = '';

      for (const row of rawRows) {
        // Fill-down tên buổi học / cấp độ / mô tả từ dòng gần nhất phía trên (đúng format mẫu)
        const rowTitle = pickField(row, ['title', 'tenbuoihoc', 'tenbaihoc']);
        const rowLevel = pickField(row, ['hsklevel', 'capdo', 'level']);
        const rowDesc = pickField(row, ['description', 'mota', 'motatomtat']);
        if (rowTitle) lastGroupTitle = rowTitle;
        if (rowLevel) lastGroupLevel = rowLevel;
        if (rowDesc) lastGroupDesc = rowDesc;

        const hasVocabContent =
          pickField(row, ['hanzi', 'chuhan', 'hantu', 'tumoi', 'tu', 'word', 'chinese']) !== '' ||
          pickField(row, ['meaning', 'nghiatiengviet', 'nghia', 'vietnamese', 'vn', 'dich']) !== '';

        const item = normalizeVocabObj(row);
        if (item) {
          vocabulary.push(item);
        } else if (hasVocabContent) {
          skipped++;
        }
      }

      if (lastGroupTitle && (!title || title === fallbackTitle)) title = lastGroupTitle;
      if (lastGroupLevel) hskLevel = normalizeLevel(lastGroupLevel);
      if (lastGroupDesc && !description) description = lastGroupDesc;

      if (skipped > 0) {
        warnings.push(`Đã bỏ qua ${skipped} dòng trong sheet "${vocabSheetName}" vì thiếu Hán tự hoặc Nghĩa tiếng Việt.`);
      }
    }

    // 3. Sheet Ngu phap (tuỳ chọn)
    const grammarSheetName = sheetByKey.get('nguphap') || sheetByKey.get('grammar');
    const grammar: ImportedGrammarItem[] = [];
    if (grammarSheetName) {
      const rawGrammar = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[grammarSheetName], {
        defval: '',
      });
      for (const row of rawGrammar) {
        const g = normalizeGrammarObj(row);
        if (g) grammar.push(g);
      }
    }

    if (vocabulary.length === 0 && grammar.length === 0) {
      return {
        ok: false,
        error:
          'Không tìm thấy từ vựng hoặc ngữ pháp hợp lệ trong file Excel. Sheet "Tu vung" cần có cột "Hán tự *" và "Nghĩa tiếng Việt *".',
      };
    }

    return {
      ok: true,
      data: {
        title: (title || 'Buổi học import từ Excel').trim(),
        hskLevel,
        unit,
        description:
          description ||
          `Import ${vocabulary.length} từ vựng${grammar.length ? ` & ${grammar.length} ngữ pháp` : ''} từ Excel`,
        vocabulary,
        grammar,
        detectedFormat: 'Excel (.xlsx/.xls)',
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Không đọc được file Excel: ${(err as Error).message}`,
    };
  }
}

export async function parseLessonImportFile(file: File): Promise<ParseImportResult> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      error: `File "${file.name}" vượt quá dung lượng tối đa 5MB.`,
    };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '').trim();

  if (ext === 'json') {
    const text = await file.text();
    return parseLessonJsonText(text, fallbackTitle);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    return parseLessonExcelBuffer(buf, fallbackTitle);
  }

  return {
    ok: false,
    error: 'Định dạng không hỗ trợ. Vui lòng chọn file .json, .xlsx hoặc .xls.',
  };
}

export const SAMPLE_IMPORT_JSON = JSON.stringify(
  {
    title: 'Buổi ôn tập: Gọi món nhà hàng',
    hskLevel: 'HSK 2',
    description: 'Từ vựng và mẫu câu giao tiếp khi đi ăn nhà hàng',
    vocabulary: [
      {
        hanzi: '菜单',
        pinyin: 'càidān',
        meaning: 'thực đơn',
        sinoVietnamese: 'thái đơn',
        type: 'Danh từ',
        radical: '艹 Thảo đầu',
        example: '请给我看看菜单。',
        examplePinyin: 'Qǐng gěi wǒ kànkan càidān.',
        exampleMeaning: 'Làm ơn cho tôi xem thực đơn.',
      },
      {
        hanzi: '点菜',
        pinyin: 'diǎncài',
        meaning: 'gọi món',
        type: 'Động từ',
        radical: '灬 Hỏa dưới',
        example: '我们现在可以点菜了吗？',
        examplePinyin: 'Wǒmen xiànzài kěyǐ diǎncài le ma?',
        exampleMeaning: 'Bây giờ chúng tôi có thể gọi món chưa?',
      },
      {
        hanzi: '买单',
        pinyin: 'mǎidān',
        meaning: 'tính tiền, thanh toán',
        type: 'Động từ',
        radical: '十 Thập',
        example: '服务员，买单！',
        examplePinyin: 'Fúwùyuán, mǎidān!',
        exampleMeaning: 'Phục vụ ơi, tính tiền!',
      },
    ],
    grammar: [
      {
        title: 'Lời mời lịch sự với 请',
        formula: '请 + Động từ + Tân ngữ',
        explanation: 'Dùng để đề nghị hoặc nhờ người khác làm gì một cách lịch sự.',
      },
    ],
  },
  null,
  2
);

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'D9D9D9' } },
  bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
  left: { style: 'thin', color: { rgb: 'D9D9D9' } },
  right: { style: 'thin', color: { rgb: 'D9D9D9' } },
};

const HEADER_REQUIRED_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'F4B183' } },
  font: { bold: true, color: { rgb: '111827' }, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
  border: THIN_BORDER,
};

const HEADER_OPTIONAL_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'BDD7EE' } },
  font: { bold: true, color: { rgb: '111827' }, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
  border: THIN_BORDER,
};

const INPUT_CELL_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } },
  font: { color: { rgb: '111827' }, sz: 11 },
  alignment: { vertical: 'center', wrapText: true },
  border: THIN_BORDER,
};

const GUIDE_BANNER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1F4E78' } },
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 13 },
  alignment: { vertical: 'center', horizontal: 'left' },
};

const GUIDE_GRAY_HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'E7E6E6' } },
  font: { bold: true, color: { rgb: '111827' }, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
  border: THIN_BORDER,
};

const GUIDE_RULE_STYLE = {
  font: { color: { rgb: '111827' }, sz: 11 },
  alignment: { vertical: 'center', wrapText: true },
};

function applyCellStyle(ws: XLSXNamespace.WorkSheet, addr: string, style: any) {
  if (!ws[addr]) ws[addr] = { t: 's', v: '' };
  ws[addr].s = style;
}

export function buildSampleExcelWorkbook(): XLSXNamespace.WorkBook {
  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: Huong dan (chuẩn format mẫu) ----
  const guideRows: any[][] = [
    ['HƯỚNG DẪN NHẬP FILE IMPORT BUỔI HỌC TIẾNG TRUNG', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['1. Nhập dữ liệu từ vựng tại sheet "Tu vung" (từ dòng 2) và ngữ pháp tại sheet "Ngu phap" (từ dòng 2, tùy chọn). Không đổi tên sheet, không thêm/xóa/đổi thứ tự cột.', '', '', '', '', '', '', '', ''],
    ['2. Tiêu đề nền cam có dấu (*) là cột bắt buộc, nền xanh dương là cột không bắt buộc. Ô nền vàng nhạt là ô nhập liệu.', '', '', '', '', '', '', '', ''],
    ['3. Cột "Tên buổi học *", "Cấp độ", "Mô tả" chỉ cần nhập ở dòng đầu tiên (dòng 2); để trống các dòng dưới thì hệ thống tự lấy theo dòng gần nhất phía trên có giá trị.', '', '', '', '', '', '', '', ''],
    ['4. Mỗi dòng từ vựng bắt buộc có "Hán tự *" và "Nghĩa tiếng Việt *". Các dòng trống màu vàng nhạt chưa nhập sẽ tự động bỏ qua.', '', '', '', '', '', '', '', ''],
    ['5. Sau khi nhập xong, kéo thả hoặc chọn file tại tab "Import buổi học" và bấm "Kiểm tra" để xem trước trước khi lưu.', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['MÔ TẢ CÁC CỘT (SHEET "Tu vung")', '', '', '', '', '', '', '', ''],
    ['Cột', 'Tiêu đề', 'Bắt buộc', 'Cách nhập', '', '', '', '', ''],
    ['A', 'Tên buổi học *', 'Có (dòng đầu)', 'Tên buổi học. Chỉ cần nhập ở dòng 2; để trống ở các dòng sau sẽ tự lấy giá trị phía trên.', '', '', '', '', ''],
    ['B', 'Cấp độ', 'Không', 'Nhập HSK 1, HSK 2, HSK 3, HSK 4 hoặc Giao tiếp. Mặc định: HSK 1.', '', '', '', '', ''],
    ['C', 'Mô tả', 'Không', 'Mô tả ngắn trọng tâm buổi học (chỉ cần nhập ở dòng đầu).', '', '', '', '', ''],
    ['D', 'STT', 'Không', 'Chỉ để đối chiếu thứ tự, hệ thống không bắt buộc.', '', '', '', '', ''],
    ['E', 'Hán tự *', 'Có', 'Từ hoặc cụm chữ Hán (ví dụ: 菜单, 点菜).', '', '', '', '', ''],
    ['F', 'Pinyin', 'Không', 'Phiên âm chuẩn có dấu thanh điệu (ví dụ: càidān).', '', '', '', '', ''],
    ['G', 'Nghĩa tiếng Việt *', 'Có', 'Nghĩa tiếng Việt ngắn gọn, rõ ràng.', '', '', '', '', ''],
    ['H', 'Bộ thủ / Mẹo', 'Không', 'Bộ thủ cấu tạo hoặc mẹo ghi nhớ.', '', '', '', '', ''],
    ['I', 'Ví dụ', 'Không', 'Câu ví dụ tiếng Trung chứa từ vựng đang học.', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['VÍ DỤ (không nhập các dòng hướng dẫn này vào sheet dữ liệu)', '', '', '', '', '', '', '', ''],
    ['Tên buổi học *', 'Cấp độ', 'Mô tả', 'STT', 'Hán tự *', 'Pinyin', 'Nghĩa tiếng Việt *', 'Bộ thủ / Mẹo', 'Ví dụ'],
    ['Buổi ôn tập: Gọi món nhà hàng', 'HSK 2', 'Từ vựng và mẫu câu gọi món', 1, '菜单', 'càidān', 'thực đơn', '艹 Thảo đầu', '请给我看看菜单。'],
    ['', '', '', 2, '点菜', 'diǎncài', 'gọi món', '灬 Hỏa dưới', '我们现在可以点菜了吗？'],
    ['', '', '', 3, '买单', 'mǎidān', 'tính tiền, thanh toán', '十 Thập', '服务员，买单！'],
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
  guideSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 5 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } },
    { s: { r: 6, c: 0 }, e: { r: 6, c: 5 } },
    { s: { r: 8, c: 0 }, e: { r: 8, c: 3 } },
    { s: { r: 20, c: 0 }, e: { r: 20, c: 5 } },
  ];
  guideSheet['!cols'] = [
    { wch: 30 },
    { wch: 22 },
    { wch: 20 },
    { wch: 56 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
  ];
  guideSheet['!rows'] = [
    { hpt: 28 },
    {},
    { hpt: 30 },
    { hpt: 30 },
    { hpt: 30 },
    { hpt: 30 },
    { hpt: 30 },
    {},
    { hpt: 22 },
    { hpt: 24 },
    ...Array.from({ length: 9 }, () => ({ hpt: 28 })),
    {},
    { hpt: 22 },
    { hpt: 24 },
  ];

  for (let c = 0; c <= 5; c++) {
    applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r: 0, c }), GUIDE_BANNER_STYLE);
  }
  for (let r = 2; r <= 6; r++) {
    applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r, c: 0 }), GUIDE_RULE_STYLE);
  }
  applyCellStyle(guideSheet, 'A9', { font: { bold: true, color: { rgb: '1F4E78' }, sz: 11 } });
  applyCellStyle(guideSheet, 'A21', { font: { bold: true, color: { rgb: '1F4E78' }, sz: 11 } });
  for (let c = 0; c <= 3; c++) {
    applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r: 9, c }), GUIDE_GRAY_HEADER_STYLE);
  }
  for (let r = 10; r <= 18; r++) {
    for (let c = 0; c <= 3; c++) {
      applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r, c }), {
        ...GUIDE_RULE_STYLE,
        border: THIN_BORDER,
      });
    }
  }
  for (let c = 0; c <= 8; c++) {
    applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r: 21, c }), GUIDE_GRAY_HEADER_STYLE);
    for (let r = 22; r <= 24; r++) {
      applyCellStyle(guideSheet, XLSX.utils.encode_cell({ r, c }), {
        ...GUIDE_RULE_STYLE,
        border: THIN_BORDER,
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong dan');

  // ---- Sheet 2: Tu vung (Header cam/xanh + 100 dòng nền vàng nhạt) ----
  const vocabHeaders = [
    'Tên buổi học *',
    'Cấp độ',
    'Mô tả',
    'STT',
    'Hán tự *',
    'Pinyin',
    'Nghĩa tiếng Việt *',
    'Bộ thủ / Mẹo',
    'Ví dụ',
  ];
  const vocabSampleRows = [
    ['Buổi ôn tập: Gọi món nhà hàng', 'HSK 2', 'Từ vựng và mẫu câu gọi món ăn', 1, '菜单', 'càidān', 'thực đơn', '艹 Thảo đầu', '请给我看看菜单。'],
    ['', '', '', 2, '点菜', 'diǎncài', 'gọi món', '灬 Hỏa dưới', '我们现在可以点菜了吗？'],
    ['', '', '', 3, '买单', 'mǎidān', 'tính tiền, thanh toán', '十 Thập', '服务员，买单！'],
  ];
  const totalVocabInputRows = 100;
  const vocabAllRows: any[][] = [
    vocabHeaders,
    ...vocabSampleRows,
    ...Array.from({ length: totalVocabInputRows - vocabSampleRows.length }, () => Array(9).fill('')),
  ];
  const vocabSheet = XLSX.utils.aoa_to_sheet(vocabAllRows);
  vocabSheet['!cols'] = [
    { wch: 32 },
    { wch: 12 },
    { wch: 30 },
    { wch: 7 },
    { wch: 16 },
    { wch: 18 },
    { wch: 26 },
    { wch: 18 },
    { wch: 30 },
  ];
  vocabSheet['!rows'] = [{ hpt: 24 }];

  const requiredVocabCols = new Set([0, 4, 6]);
  for (let c = 0; c < vocabHeaders.length; c++) {
    applyCellStyle(
      vocabSheet,
      XLSX.utils.encode_cell({ r: 0, c }),
      requiredVocabCols.has(c) ? HEADER_REQUIRED_STYLE : HEADER_OPTIONAL_STYLE
    );
  }
  for (let r = 1; r <= totalVocabInputRows; r++) {
    for (let c = 0; c < vocabHeaders.length; c++) {
      applyCellStyle(vocabSheet, XLSX.utils.encode_cell({ r, c }), INPUT_CELL_STYLE);
    }
  }
  XLSX.utils.book_append_sheet(wb, vocabSheet, 'Tu vung');

  // ---- Sheet 3: Ngu phap (Header cam/xanh + 50 dòng nền vàng nhạt) ----
  const grammarHeaders = ['STT', 'Tên cấu trúc *', 'Công thức', 'Giải thích'];
  const grammarSampleRows = [
    [1, 'Lời mời lịch sự với 请', '请 + Động từ + Tân ngữ', 'Dùng để đề nghị hoặc nhờ người khác làm gì một cách lịch sự.'],
  ];
  const totalGrammarInputRows = 50;
  const grammarAllRows: any[][] = [
    grammarHeaders,
    ...grammarSampleRows,
    ...Array.from({ length: totalGrammarInputRows - grammarSampleRows.length }, () => Array(4).fill('')),
  ];
  const grammarSheet = XLSX.utils.aoa_to_sheet(grammarAllRows);
  grammarSheet['!cols'] = [{ wch: 7 }, { wch: 32 }, { wch: 30 }, { wch: 52 }];
  grammarSheet['!rows'] = [{ hpt: 24 }];

  for (let c = 0; c < grammarHeaders.length; c++) {
    applyCellStyle(
      grammarSheet,
      XLSX.utils.encode_cell({ r: 0, c }),
      c === 1 ? HEADER_REQUIRED_STYLE : HEADER_OPTIONAL_STYLE
    );
  }
  for (let r = 1; r <= totalGrammarInputRows; r++) {
    for (let c = 0; c < grammarHeaders.length; c++) {
      applyCellStyle(grammarSheet, XLSX.utils.encode_cell({ r, c }), INPUT_CELL_STYLE);
    }
  }
  XLSX.utils.book_append_sheet(wb, grammarSheet, 'Ngu phap');

  return wb;
}

export function downloadSampleExcel(): void {
  const wb = buildSampleExcelWorkbook();
  XLSX.writeFile(wb, 'mau-import-buoi-hoc.xlsx');
}

export function downloadSampleJson(): void {
  const blob = new Blob([SAMPLE_IMPORT_JSON], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mau-import-buoi-hoc.json';
  a.click();
  URL.revokeObjectURL(url);
}
