import type {
  AnyGameGradeDirection,
  AnyTranslationDirection,
  DictionaryPromptInput,
  GameGradingPromptInput,
  LanguageStrategy,
  QuickLookupPromptInput,
} from '../types.js';

const VIETNAMESE_DIACRITIC_REGEX =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const EN_CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bcan't\b/gi, 'cannot'],
  [/\bwon't\b/gi, 'will not'],
  [/\bshan't\b/gi, 'shall not'],
  [/n't\b/gi, ' not'],
  [/\bi'm\b/gi, 'i am'],
  [/\bhe's\b/gi, 'he is'],
  [/\bshe's\b/gi, 'she is'],
  [/\bit's\b/gi, 'it is'],
  [/\bthat's\b/gi, 'that is'],
  [/\bthere's\b/gi, 'there is'],
  [/\bwhat's\b/gi, 'what is'],
  [/\bwe're\b/gi, 'we are'],
  [/\bthey're\b/gi, 'they are'],
  [/\byou're\b/gi, 'you are'],
  [/\bi've\b/gi, 'i have'],
  [/\bwe've\b/gi, 'we have'],
  [/\bthey've\b/gi, 'they have'],
  [/\byou've\b/gi, 'you have'],
  [/\bi'll\b/gi, 'i will'],
  [/\bwe'll\b/gi, 'we will'],
  [/\bthey'll\b/gi, 'they will'],
  [/\byou'll\b/gi, 'you will'],
  [/\bhe'll\b/gi, 'he will'],
  [/\bshe'll\b/gi, 'she will'],
];

const UK_US_EQUIVALENTS: ReadonlyArray<[RegExp, string]> = [
  [/\bcolour(s|ed|ing)?\b/gi, 'color$1'],
  [/\bfavour(ite|ites|s|ed|ing)?\b/gi, 'favor$1'],
  [/\bcentre(s)?\b/gi, 'center$1'],
  [/\btheatre(s)?\b/gi, 'theater$1'],
  [/\btravell(ed|ing|er|ers)\b/gi, 'travel$1'],
  [/\borganis(e|ed|es|ing|ation|ations)\b/gi, 'organiz$1'],
  [/\brealis(e|ed|es|ing)\b/gi, 'realiz$1'],
  [/\bprogramm(e|es)\b/gi, 'program$1'],
  [/\bneighbour(s|hood|ing)?\b/gi, 'neighbor$1'],
];

export function normalizeEnglishAnswer(text: string): string {
  let out = String(text || '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
  for (const [rx, rep] of EN_CONTRACTIONS) {
    out = out.replace(rx, rep);
  }
  for (const [rx, rep] of UK_US_EQUIVALENTS) {
    out = out.replace(rx, rep);
  }
  return out
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const enStrategy: LanguageStrategy = {
  meta: {
    code: 'en',
    name: 'Tiếng Anh',
    nativeName: 'English · CEFR / IELTS',
    description: 'Lộ trình từ vựng Tiếng Anh CEFR A1–C2 (Word Atlas) kèm hình minh họa, audio UK/US và gia sư AI.',
    accentTheme: 'indigo',
    sortOrder: 2,
    defaultLevel: 'CEFR A1',
    examTitleAll: 'Kiểm tra tổng hợp Tiếng Anh (A1–C2)',
    examLevelRange: 'CEFR A1 - IELTS',
  },

  normalizeDirection(raw?: string): AnyTranslationDirection {
    if (raw === 'en_vi' || raw === 'vi_en') return raw;
    return 'auto';
  },

  normalizeGameDirection(raw?: string): AnyGameGradeDirection {
    if (raw === 'en_to_vi' || raw === 'zh_to_vi') return 'en_to_vi';
    return 'vi_to_en';
  },

  detectInputLanguage(text: string): 'en' | 'vi' {
    if (VIETNAMESE_DIACRITIC_REGEX.test(text)) return 'vi';
    return 'en';
  },

  cleanQuickLookupWord(raw: string): string {
    return raw
      .trim()
      .replace(/[^A-Za-z0-9'\-\s]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  },

  normalizeAnswerForExactMatch(text: string, isTargetLang: boolean): string {
    if (isTargetLang) return normalizeEnglishAnswer(text);
    return String(text || '')
      .toLowerCase()
      .replace(/[，。！？、；：,.!?;:'"“”‘’（）()\s\-—·…]/g, '')
      .trim();
  },

  buildDictionaryPrompts({ query, direction }: DictionaryPromptInput) {
    const dirInstruction =
      direction === 'en_vi'
        ? 'Hãy dịch và phân tích từ/cụm/câu tiếng Anh sang tiếng Việt theo chuẩn từ điển Oxford/Cambridge Anh–Việt.'
        : direction === 'vi_en'
          ? 'Hãy dịch từ/cụm/câu tiếng Việt sang tiếng Anh tự nhiên chuẩn bản ngữ (kèm phiên âm IPA, collocations và giải thích cách dùng).'
          : 'Tự nhận diện ngôn ngữ đầu vào (tiếng Anh hay tiếng Việt) rồi dịch và phân tích chi tiết sang ngôn ngữ còn lại.';

    const systemInstruction = `Bạn là từ điển học thuật Anh–Việt chuyên sâu cho người Việt học CEFR / IELTS.
${dirInstruction}
Luôn trả về DUY NHẤT một JSON object hợp lệ (không markdown dư thừa) với đúng các field sau:
{
  "detectedLanguage": "en" | "vi" | "mixed",
  "isSentence": boolean,
  "hanzi": "Từ/cụm/câu tiếng Anh chuẩn (nếu input là tiếng Việt thì là bản dịch tiếng Anh tự nhiên nhất)",
  "pinyin": "Phiên âm IPA chuẩn (vd: UK /ˈlaɪbrəri/ · US /ˈlaɪbreri/), hoặc chuỗi rỗng nếu là câu dài",
  "sinoVietnamese": "Chỉ ghi mã bậc CEFR ngắn gọn nếu là từ/cụm từ (vd: A1, A2, B1, B2, C1, C2 — KHÔNG ghi chữ CEFR), hoặc null nếu là câu dài",
  "wordType": "Từ loại ngắn gọn (vd: n., v., adj., adv., prep.) hoặc null nếu là câu dài",
  "meaning": "Nghĩa tiếng Việt tóm tắt súc tích nhất (hoặc bản dịch tiếng Việt tự nhiên nếu input là câu tiếng Anh)",
  "meanings": ["BẮT BUỘC mở đầu mỗi nét nghĩa bằng ký hiệu từ loại tiếng Anh nếu isSentence=false, vd: \"adv. Ra khỏi vị trí bên trong, đi ra ngoài\", \"prep. Ngoài, ra khỏi...\", \"adj. Đã tắt, hết, không còn...\", \"v. Tiết lộ, công khai...\" (nếu isSentence=true thì để mảng rỗng [])"],
  "radical": "Word Family (họ từ liên quan, vd: librarian (n.), library (n.)), hoặc null",
  "breakdown": "Từ đồng nghĩa / trái nghĩa ngắn gọn (vd: Đồng nghĩa: powerful, sturdy · Trái nghĩa: weak), hoặc null",
  "mnemonic": "Mẹo phân biệt từ dễ nhầm hoặc lưu ý sắc thái (1-2 câu tiếng Việt), hoặc null",
  "grammarNote": "Cách dùng ngữ pháp, giới từ đi kèm hoặc văn phong (trang trọng/thân mật) bằng tiếng Việt (1-3 câu)",
  "compounds": [
    { "hanzi": "Collocation / cụm từ cố định phổ biến đi kèm từ này (4-6 cụm nếu isSentence=false, mảng rỗng [] nếu là câu dài)", "pinyin": "Từ loại/ngữ cảnh ngắn", "meaning": "Nghĩa tiếng Việt tự nhiên" }
  ],
  "examples": [
    { "hanzi": "Câu ví dụ tiếng Anh tự nhiên (gồm 1 câu giao tiếp hằng ngày và 1 câu IELTS/học thuật)", "pinyin": "", "meaning": "Bản dịch tiếng Việt tự nhiên" }
  ]
}`;

    return {
      systemInstruction,
      userPrompt: `Tra từ / Dịch cụm câu Tiếng Anh–Việt sau: "${query.trim()}"`,
    };
  },

  buildQuickLookupPrompts({ word, context }: QuickLookupPromptInput) {
    const contextClean = (context || '').trim().slice(0, 220);
    const systemInstruction = [
      'Bạn là từ điển Anh–Việt ngắn gọn chuẩn Oxford/Cambridge cho thẻ gợi ý di chuột.',
      'Chỉ trả về JSON thuần đúng cấu trúc: {"hanzi": string, "pinyin": string, "sinoVietnamese": string | null, "wordType": string | null, "meaning": string}.',
      'Quy tắc:',
      '- hanzi: từ tiếng Anh dạng gốc (hoặc giữ nguyên từ đang tra).',
      '- pinyin: phiên âm IPA chuẩn (vd "/ˈlaɪbreri/").',
      '- sinoVietnamese: bậc CEFR (A1..C2) hoặc null.',
      '- wordType: từ loại ngắn (vd "n.", "v.", "adj.", "n. / v.").',
      '- meaning: nghĩa tiếng Việt súc tích (tối đa 110 ký tự), ưu tiên đúng nghĩa trong câu ngữ cảnh nếu có.',
    ].join('\n');

    const userPrompt = contextClean
      ? `Tra nhanh từ tiếng Anh: ${word}\nCâu ngữ cảnh: ${contextClean}`
      : `Tra nhanh từ tiếng Anh: ${word}`;

    return { systemInstruction, userPrompt };
  },

  buildGameGradingPrompts({
    mode,
    direction,
    promptText,
    expectedTarget,
    expectedMeaning,
    userAnswer,
  }: GameGradingPromptInput) {
    const systemInstruction =
      mode === 'scramble'
        ? [
            'Bạn là giáo viên tiếng Anh IELTS/CEFR giàu kinh nghiệm, chấm bài Sắp xếp từ thành câu tiếng Anh.',
            'QUAN TRỌNG: Phải phân tích kỹ ngữ pháp trong trường "analysis" TRƯỚC rồi mới chốt "isCorrect" nhất quán 100% với phần phân tích.',
            'Chỉ trả về JSON thuần: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
            'Quy tắc chấm:',
            '- KHÔNG chấm sai chỉ vì khác vị trí trạng ngữ thời gian/nơi chốn so với câu mẫu (vd "Every spring we plant flowers..." = "We plant flowers every spring..."), hoặc thiếu/thừa dấu chấm câu/viết hoa đầu câu.',
            '- CHẤP NHẬN (isCorrect=true) khi câu tiếng Anh đúng ngữ pháp, tự nhiên và khớp nghĩa với đề tiếng Việt.',
            '- TỪ CHỐI (isCorrect=false) khi sai trật tự ngữ pháp tiếng Anh (sai vị trí trợ động từ, tính từ-danh từ, giới từ, đảo sai chủ ngữ-tân ngữ).',
            '- Trường feedback viết bằng tiếng Việt ngắn gọn (1 câu, tối đa 180 ký tự), KHÔNG mở đầu bằng "Chính xác!", "Đúng rồi!" hay "Sai rồi!".',
          ].join('\n')
        : direction === 'vi_to_en'
          ? [
              'Bạn là giáo viên tiếng Anh IELTS/CEFR chấm bài Dịch Việt → Anh.',
              'Phải phân tích kỹ trong "analysis" TRƯỚC rồi mới chốt "isCorrect" nhất quán 100% với phân tích.',
              'Chỉ trả về JSON thuần: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
              'Quy tắc chấm:',
              '- BẮT BUỘC CHẤP NHẬN (isCorrect=true) nếu câu tiếng Anh dịch ĐỦ Ý CHÍNH, đúng ngữ pháp và tự nhiên, kể cả dùng từ đồng nghĩa (vd "vacation"/"holiday", "apartment"/"flat"), dạng rút gọn ("don\'t"/"do not"), hay chính tả Anh-Anh / Anh-Mỹ ("travelled"/"traveled", "colour"/"color").',
              '- TỪ CHỐI (isCorrect=false) nếu sai thì nghiêm trọng làm đổi nghĩa, thiếu vế ý chính, hoặc sai ngữ pháp cơ bản.',
              '- Trường feedback viết bằng tiếng Việt ngắn gọn (1-2 câu, tối đa 220 ký tự).',
            ].join('\n')
          : [
              'Bạn là giáo viên tiếng Anh IELTS/CEFR chấm bài Dịch Anh → Việt.',
              'Phải phân tích kỹ trong "analysis" TRƯỚC rồi mới chốt "isCorrect" nhất quán 100% với phân tích.',
              'Chỉ trả về JSON thuần: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
              'Quy tắc chấm:',
              '- BẮT BUỘC CHẤP NHẬN (isCorrect=true) nếu bản dịch tiếng Việt đúng và ĐỦ Ý CHÍNH của câu tiếng Anh, chấp nhận khác đại từ xưng hô hoặc cách diễn đạt tương đương tự nhiên.',
              '- TỪ CHỐI (isCorrect=false) nếu dịch thiếu thông tin quan trọng hoặc hiểu sai nghĩa chính.',
              '- Trường feedback viết bằng tiếng Việt ngắn gọn (1-2 câu, tối đa 220 ký tự).',
            ].join('\n');

    const userPrompt =
      mode === 'scramble'
        ? [
            `Nghĩa tiếng Việt: ${promptText}`,
            `Câu tiếng Anh chuẩn tham khảo: ${expectedTarget}`,
            `Câu người học ghép: ${userAnswer}`,
          ].join('\n')
        : direction === 'vi_to_en'
          ? [
              `Đề tiếng Việt cần dịch: ${promptText}`,
              `Đáp án tiếng Anh tham khảo: ${expectedTarget || '(không có)'}`,
              `Câu trả lời của người học: ${userAnswer}`,
            ].join('\n')
          : [
              `Câu tiếng Anh cần dịch: ${promptText}`,
              `Nghĩa tiếng Việt tham khảo: ${expectedMeaning || '(không có)'}`,
              `Bản dịch của người học: ${userAnswer}`,
            ].join('\n');

    return { systemInstruction, userPrompt };
  },

  buildTutorRoleInstruction(): string {
    return 'Bạn là Gia sư tiếng Anh CEFR / IELTS thông minh, thân thiện và đồng hành trực tiếp trên nền tảng học ngoại ngữ.';
  },
};
