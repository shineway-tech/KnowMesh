const templateLibraryVersion = "1.2.0";

const k12StageOptions = [
  { value: "小学", label: { zh: "小学", en: "Primary" } },
  { value: "初中", label: { zh: "初中", en: "Junior high" } },
  { value: "高中", label: { zh: "高中", en: "Senior high" } }
];

const k12SubjectOptions = [
  { value: "语文", label: { zh: "语文", en: "Chinese" }, stages: ["小学", "初中", "高中"] },
  { value: "数学", label: { zh: "数学", en: "Mathematics" }, stages: ["小学", "初中", "高中"] },
  { value: "英语", label: { zh: "英语", en: "English" }, stages: ["小学", "初中", "高中"] },
  { value: "道德与法治", label: { zh: "道德与法治", en: "Morality and Law" }, stages: ["小学", "初中"] },
  { value: "科学", label: { zh: "科学", en: "Science" }, stages: ["小学"] },
  { value: "历史", label: { zh: "历史", en: "History" }, stages: ["初中", "高中"] },
  { value: "地理", label: { zh: "地理", en: "Geography" }, stages: ["初中", "高中"] },
  { value: "物理", label: { zh: "物理", en: "Physics" }, stages: ["初中", "高中"] },
  { value: "化学", label: { zh: "化学", en: "Chemistry" }, stages: ["初中", "高中"] },
  { value: "生物", label: { zh: "生物", en: "Biology" }, stages: ["初中", "高中"] },
  { value: "思想政治", label: { zh: "思想政治", en: "Politics" }, stages: ["高中"] },
  { value: "信息科技", label: { zh: "信息科技", en: "Information Technology" }, stages: ["小学", "初中", "高中"] },
  { value: "体育与健康", label: { zh: "体育与健康", en: "PE and Health" }, stages: ["小学", "初中", "高中"] },
  { value: "音乐", label: { zh: "音乐", en: "Music" }, stages: ["小学", "初中", "高中"] },
  { value: "美术", label: { zh: "美术", en: "Fine Arts" }, stages: ["小学", "初中", "高中"] }
];

const k12GradeOptions = [
  { value: "一年级", label: { zh: "一年级", en: "Grade 1" }, stages: ["小学"] },
  { value: "二年级", label: { zh: "二年级", en: "Grade 2" }, stages: ["小学"] },
  { value: "三年级", label: { zh: "三年级", en: "Grade 3" }, stages: ["小学"] },
  { value: "四年级", label: { zh: "四年级", en: "Grade 4" }, stages: ["小学"] },
  { value: "五年级", label: { zh: "五年级", en: "Grade 5" }, stages: ["小学"] },
  { value: "六年级", label: { zh: "六年级", en: "Grade 6" }, stages: ["小学"] },
  { value: "七年级", label: { zh: "七年级", en: "Grade 7" }, stages: ["初中"] },
  { value: "八年级", label: { zh: "八年级", en: "Grade 8" }, stages: ["初中"] },
  { value: "九年级", label: { zh: "九年级", en: "Grade 9" }, stages: ["初中"] },
  { value: "高一", label: { zh: "高一", en: "Senior 1" }, stages: ["高中"] },
  { value: "高二", label: { zh: "高二", en: "Senior 2" }, stages: ["高中"] },
  { value: "高三", label: { zh: "高三", en: "Senior 3" }, stages: ["高中"] }
];

const k12VolumeOptions = [
  { value: "上册", label: { zh: "上册", en: "Volume 1" }, stages: ["小学", "初中"] },
  { value: "下册", label: { zh: "下册", en: "Volume 2" }, stages: ["小学", "初中"] },
  { value: "全一册", label: { zh: "全一册", en: "Single volume" }, stages: ["初中"] },
  { value: "必修", label: { zh: "必修", en: "Compulsory" }, stages: ["高中"] },
  { value: "选择性必修", label: { zh: "选择性必修", en: "Selective compulsory" }, stages: ["高中"] }
];

const commonArchivePolicy = {
  strategy: "archive-originals",
  archiveOriginals: true,
  vectorizeOriginals: false,
  noUploadDownloadLoop: true,
  summary: {
    zh: "原始文件用于追溯、审计和回滚; 向量化只使用清洗后的处理结果。",
    en: "Original files are archived for traceability, audit, and rollback; only cleaned processing output is vectorized."
  }
};

const commonProcessingInputPolicy = {
  textLike: {
    formats: ["txt", "md", "markdown", "csv", "tsv", "rtf"],
    action: "local-extract",
    vectorizeFrom: "cleaned-chunks"
  },
  office: {
    formats: ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"],
    action: "local-structured-extract",
    macroPolicy: "never-execute",
    vectorizeFrom: "cleaned-chunks"
  },
  legacyOffice: {
    formats: ["doc", "xls", "ppt", "wps", "et", "dps"],
    action: "local-convert-then-extract",
    fallback: "review-required",
    vectorizeFrom: "cleaned-chunks"
  },
  readablePdf: {
    action: "local-text-layer-extract",
    pageMapRequired: true,
    vectorizeFrom: "cleaned-chunks"
  },
  scannedPdf: {
    action: "render-page-tasks",
    splitByPage: true,
    ocrInput: "page-image-tasks",
    vectorizeFrom: "ocr-cleaned-chunks"
  },
  mixedPdf: {
    action: "text-pages-plus-ocr-pages",
    splitByPage: true,
    vectorizeFrom: "merged-cleaned-chunks"
  },
  image: {
    formats: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"],
    action: "page-ocr",
    ocrInput: "original-image",
    vectorizeFrom: "ocr-cleaned-chunks"
  }
};

const commonCitationPolicy = {
  required: true,
  minimumFields: ["document_id", "version_id", "sourceUri", "page_start", "page_end"],
  sourceExcerptRequired: true,
  summary: {
    zh: "回答必须能回到原始资料、页码或章节位置和原文片段。",
    en: "Answers must trace back to source material, page or section location, and source excerpt."
  }
};

const commonAliyunMetadataContract = {
  authoritativeStore: "oss-sidecar",
  vectorMetadataMode: "compact-filter-fields",
  vectorMetadataFields: ["kb", "ver", "doc", "cid", "fgs", "pub", "vol", "unit", "ctype", "q", "sidecar"],
  sidecarObjects: ["manifest.json", "chunks/*.jsonl", "citations/citation-map.jsonl", "quality/review-required.jsonl", "templates/template-contract.json"],
  summary: {
    zh: "阿里云模式下, 向量 Bucket 只保存筛选字段和 Sidecar 指针; 完整来源、页码、片段、质量和模板契约保存在 OSS Sidecar。",
    en: "In Aliyun mode, the vector bucket stores only filter fields and a Sidecar pointer; full source, page, excerpt, quality, and template contracts live in OSS Sidecar."
  }
};

const commonTemplateProcessingPolicy = {
  archivePolicy: commonArchivePolicy,
  processingInputPolicy: commonProcessingInputPolicy,
  citationPolicy: commonCitationPolicy,
  aliyunMetadataContract: commonAliyunMetadataContract
};

const templates = [
  {
    id: "textbook-cn-k12",
    version: "1.2.0",
    status: "built-in",
    recommended: true,
    supportedModes: ["aliyun", "local"],
    defaultMode: "aliyun",
    templateRole: "industry-extension",
    extendsTemplate: "general-docs",
    coreName: "KnowMesh Core",
    expertId: "k12",
    expertName: "KnowMesh Expert · K12",
    ...commonTemplateProcessingPolicy,
    title: {
      zh: "K12 教材知识库",
      en: "K12 Textbook Knowledge Base"
    },
    shortTitle: {
      zh: "K12 教材",
      en: "K12 Textbooks"
    },
    summary: {
      zh: "适合按学段、学科、年级、册别和页码整理教材资料，能把回答引用回教材页码。",
      en: "For textbook folders organized by stage, subject, grade, volume, and page citation."
    },
    commercialFit: {
      zh: "面向学校、教培、出版社、题库和教育产品团队的商用教材知识库。",
      en: "For schools, tutoring teams, publishers, question banks, and education products."
    },
    bestFor: [
      {
        zh: "成套教材、讲义、教参、练习册和扫描版 PDF。",
        en: "Textbooks, handouts, teacher guides, workbooks, and scanned PDFs."
      },
      {
        zh: "需要按学段、年级、学科、章节和页码追溯来源的知识库。",
        en: "Knowledge bases that need stage, grade, subject, chapter, and page traceability."
      },
      {
        zh: "已经整理在本机或移动硬盘中的教材目录。",
        en: "Textbook folders already organized on this machine or an external drive."
      }
    ],
    notFor: [
      {
        zh: "大量网页碎片、论坛帖子或没有页码来源的资料。",
        en: "Loose web snippets, forum posts, or sources without stable page references."
      },
      {
        zh: "需要直接生成题目答案但不关心引用来源的轻量问答。",
        en: "Lightweight Q&A that does not care about source citations."
      }
    ],
    defaultPaths: {
      source: "source",
      work: "workspace"
    },
    requiredFields: [
      { key: "source.root", label: { zh: "资料目录", en: "Source folder" }, required: true },
      { key: "workspace.root", label: { zh: "工作目录", en: "Work folder" }, required: true },
      {
        key: "metadata.stage",
        type: "multi-select",
        label: { zh: "学段范围", en: "School stages" },
        required: true,
        options: k12StageOptions
      },
      {
        key: "metadata.subject",
        type: "multi-select",
        label: { zh: "学科范围", en: "Subjects" },
        required: true,
        options: k12SubjectOptions
      },
      {
        key: "metadata.grade",
        type: "multi-select",
        label: { zh: "年级范围", en: "Grades" },
        required: true,
        options: k12GradeOptions
      },
      {
        key: "metadata.volume",
        type: "multi-select",
        label: { zh: "册别范围", en: "Volumes" },
        required: false,
        options: k12VolumeOptions
      },
      { key: "metadata.publisher", label: { zh: "出版社", en: "Publisher" }, required: false },
      { key: "metadata.edition", label: { zh: "版本/版次", en: "Edition" }, required: false }
    ],
    metadataFields: [
      "stage",
      "subject",
      "grade",
      "volume",
      "publisher",
      "edition",
      "year",
      "chapter",
      "unit",
      "lesson",
      "lesson_order_no",
      "lesson_title",
      "content_type",
      "page_start",
      "page_end",
      "knowledge_point",
      "exercise_id",
      "figure_id",
      "formula_id",
      "source_parts"
    ],
    metadataContract: {
      requiredForSearch: ["stage", "subject", "grade", "publisher", "volume", "unit", "lesson", "lesson_order_no", "content_type"],
      requiredForCitation: ["document_id", "version_id", "sourceUri", "page_start", "page_end", "excerpt"],
      optionalButRecommended: ["chapter", "lesson", "lesson_title", "knowledge_point", "exercise_id", "figure_id", "formula_id"],
      queryFilters: [
        { zh: "学段", en: "Stage" },
        { zh: "年级", en: "Grade" },
        { zh: "学科", en: "Subject" },
        { zh: "出版社", en: "Publisher" },
        { zh: "册别", en: "Volume" },
        { zh: "单元", en: "Unit" },
        { zh: "单元内课次", en: "Lesson order in unit" },
        { zh: "课文标题", en: "Lesson title" },
        { zh: "内容类型", en: "Content type" }
      ],
      summary: {
        zh: "K12 会把用户问题里的学段、年级、学科、出版社、册别、单元和明确课次转成范围约束; 目录课文锚点、单元内课次和课文标题会优先参与排序, 防止五年级问题命中六年级资料, 也避免只拿到单元导语。",
        en: "K12 turns stage, grade, subject, publisher, volume, unit, and explicit lesson into scope constraints; table-of-contents anchors, lesson order, and lesson title are ranked first so grade-5 questions do not hit grade-6 material or stop at unit intros."
      }
    },
    organizationRules: [
      {
        zh: "按学段、年级、学科、册别、单元、课文/章节和页码建立来源路径。",
        en: "Build source paths by stage, grade, subject, volume, unit, lesson/chapter, and page."
      },
      {
        zh: "目录页转成章节结构，封面和版权页转成元数据，不作为普通正文检索。",
        en: "Turn tables of contents into chapter structure; turn covers and copyright pages into metadata."
      },
      {
        zh: "分卷 PDF 会按 .pdf.1、.pdf.2 顺序作为同一本资料处理。",
        en: "Split PDF files such as .pdf.1 and .pdf.2 are handled as one source."
      }
    ],
    domainProcessingPolicy: {
      unitOfMeaning: "teaching-unit",
      tocHandling: "chapter-structure",
      coverHandling: "metadata-only",
      copyrightHandling: "metadata-only",
      chunkingBasis: {
        zh: "优先按单元、课时、知识点、例题、习题和页码组织, 固定字数只作为兜底。",
        en: "Prefer unit, lesson, knowledge point, example, exercise, and page boundaries; fixed length is fallback only."
      },
      validationFocus: {
        zh: "确认知识点、题目、图表、公式和引用页码没有被拆散。",
        en: "Ensure knowledge points, exercises, figures, formulas, and page citations stay connected."
      }
    },
    modalityPolicy: {
      formula: {
        action: "structure-or-review",
        preferredFormat: "latex-or-source-text",
        zh: "公式优先结构化保存; 不能可靠识别时进入待确认, 不直接丢弃。",
        en: "Formulas are structured first; if unreliable, send to review instead of dropping them."
      },
      table: {
        action: "structure-or-review",
        preferredFormat: "markdown-or-json",
        zh: "表格保留行列关系和表头, 不按普通段落切碎。",
        en: "Tables keep row/column relationships and headers instead of being split as plain paragraphs."
      },
      figure: {
        action: "bind-to-context",
        bindTo: "nearest-knowledge-point",
        zh: "图片、几何图、实验图和示意图绑定到邻近题干、例题或知识点。",
        en: "Figures, geometry diagrams, lab images, and illustrations bind to nearby stems, examples, or knowledge points."
      },
      exercise: {
        keepTogether: true,
        zh: "题干、选项、答案和解析作为一个教学单元处理。",
        en: "Stem, options, answer, and explanation are handled as one teaching unit."
      }
    },
    chunkingPolicy: {
      strategy: {
        zh: "章节和页码优先, 语义长度兜底。",
        en: "Section and page first, semantic length as fallback."
      },
      targetSize: {
        zh: "每片约 600-1000 个中文字符, 题目和表格允许更短。",
        en: "About 600-1000 Chinese characters per chunk; exercises and tables may be shorter."
      },
      overlap: {
        zh: "同一章节内保留标题、页码和少量上文, 不跨教材版本混合。",
        en: "Keep headings, page labels, and light local context; do not mix textbook editions."
      },
      preserve: [
        { zh: "教材、页码、章节标题和来源分卷。", en: "Textbook, page, chapter heading, and split-source parts." },
        { zh: "例题、习题、实验步骤和阅读材料的完整上下文。", en: "Full context for examples, exercises, lab steps, and readings." },
        { zh: "公式、图表说明和表格的结构化表示。", en: "Structured representation of formulas, captions, and tables." }
      ]
    },
    qualityGates: [
      { zh: "引用必须能回到教材、页码或章节标题。", en: "Citations must trace back to textbook, page, or chapter heading." },
      { zh: "目录页必须尽量转成单元、课文标题和单元内课次锚点，不能只作为普通正文进入检索。", en: "Tables of contents should become unit, lesson-title, and lesson-order anchors instead of plain searchable text only." },
      { zh: "页眉页脚、水印和下载站提示不得进入可检索正文。", en: "Headers, footers, watermarks, and download prompts must not enter searchable text." },
      { zh: "低置信 OCR、双栏错序和疑似敏感信息必须进入待确认清单。", en: "Low-confidence OCR, column-order issues, and possible sensitive data must go to review." }
    ],
    pitfalls: [
      { zh: "扫描版 PDF 可能没有可读文字, OCR 完成前不会生成可检索正文。", en: "Scanned PDFs may have no readable text; searchable body text is only created after OCR succeeds." },
      { zh: "不同版次教材页码不同, 缺页码或混版会导致引用不可信。", en: "Different editions have different page numbers; missing pages or mixed editions make citations unreliable." },
      { zh: "目录、封面和版权页应转元数据, 不能当普通正文向量化。", en: "Tables of contents, covers, and copyright pages should become metadata, not normal searchable text." }
    ],
    acceptanceCriteria: [
      { zh: "模板问题能返回正确教材、页码和原文片段。", en: "Template questions return the right textbook, page, and source excerpt." },
      { zh: "抽检过滤报告, 噪声被过滤且正文没有被误删。", en: "Sample the filter report: noise is removed without deleting body text." },
      { zh: "新增或替换教材后能区分新旧版本并保留回滚路径。", en: "Added or replaced textbooks keep version separation and rollback path." }
    ],
    vectorFilterPolicy: {
      label: {
        zh: "进入检索库前过滤",
        en: "Filtering Before Search Library"
      },
      remove: [
        {
          zh: "重复页眉、页脚、页码行、下载站水印和扫描页边噪声。",
          en: "Repeated headers, footers, page-number lines, download-site watermarks, and scan-edge noise."
        },
        {
          zh: "孤立网址、二维码提示、广告导航文字和无意义符号串。",
          en: "Isolated URLs, QR-code prompts, ad/navigation text, and meaningless symbol runs."
        },
        {
          zh: "OCR 产生的明显乱码、断字噪声和跨页重复版权声明。",
          en: "Obvious OCR garbage, broken-word noise, and repeated copyright notices."
        }
      ],
      metadataOnly: [
        {
          zh: "封面书名、出版社、版次、年份和版权信息。",
          en: "Cover title, publisher, edition, year, and copyright information."
        },
        {
          zh: "目录页结构、章节标题、页码和来源文件路径。",
          en: "Table-of-contents structure, chapter titles, page numbers, and source paths."
        },
        {
          zh: "被过滤的网址、水印和版权提示会进入过滤报告。",
          en: "Filtered URLs, watermarks, and copyright notices are kept in the filter report."
        }
      ],
      keep: [
        {
          zh: "正文、课文、例题、习题、实验步骤、阅读材料和可解释的图表说明。",
          en: "Body text, lessons, examples, exercises, lab steps, reading material, and useful figure/table captions."
        },
        {
          zh: "公式和表格先结构化，再按章节和页码保留上下文。",
          en: "Formulas and tables are structured first, then kept with chapter and page context."
        }
      ],
      review: [
        {
          zh: "OCR 置信度低、双栏错序、隐藏文字、极小字号文字和疑似提示注入内容。",
          en: "Low-confidence OCR, misordered two-column text, hidden text, tiny text, and suspected prompt-injection content."
        },
        {
          zh: "学生姓名、手机号、身份证号等敏感信息默认进入待确认清单。",
          en: "Student names, phone numbers, national IDs, and similar sensitive data go to review by default."
        }
      ],
      reportFields: [
        "document_id",
        "page_number",
        "rule_id",
        "action",
        "original_text",
        "reason",
        "confidence",
        "review_required"
      ]
    },
    safetyGates: [
      { zh: "上传资料前确认范围、数量和预计费用。", en: "Confirm scope, volume, and estimated cost before upload." },
      { zh: "调用文字识别和内容整理前展示成本与可回滚性。", en: "Show cost and rollback path before text recognition and organization." },
      { zh: "写入检索库前展示过滤报告和待确认项。", en: "Show the filter report and review items before writing to the search library." }
    ],
    evaluationQuestions: [
      {
        zh: "五年级统编版语文第三单元第一课是什么？如果没有指定册别，需要分别查看上下册并引用来源。",
        en: "What is the first lesson in unit 3 of grade 5 unified-edition Chinese? If no volume is specified, check both volumes and cite sources."
      },
      {
        zh: "人教版数学五年级上册第三单元讲哪些知识点？回答必须带教材页码。",
        en: "What knowledge points are covered in unit 3 of grade 5 volume 1 Renjiao math? Include textbook page citations."
      },
      {
        zh: "英语五年级上册第三单元有哪些重点词汇？需要能回到原文或词汇表位置。",
        en: "What key vocabulary appears in unit 3 of grade 5 volume 1 English? Link back to the original text or vocabulary list."
      },
      {
        zh: "找出初中物理关于密度的定义，并引用原文片段。",
        en: "Find the definition of density in junior high physics and cite the original excerpt."
      }
    ],
    updatePolicy: {
      zh: "新增教材时先重扫目录，只对新增或变更文件生成新版本；旧版本可回滚。",
      en: "When adding textbooks, rescan first and version only new or changed files; previous versions remain restorable."
    },
    migrationPolicy: {
      zh: "模板升级时必须保留字段映射、过滤规则版本和旧知识库版本引用。",
      en: "Template upgrades must preserve field mappings, filter-rule versions, and previous knowledge-base references."
    }
  },
  {
    id: "general-docs",
    version: "1.2.0",
    status: "built-in",
    recommended: false,
    supportedModes: ["aliyun", "local"],
    defaultMode: "local",
    templateRole: "fallback",
    extendsTemplate: null,
    coreName: "KnowMesh Core",
    expertId: null,
    expertName: null,
    ...commonTemplateProcessingPolicy,
    title: {
      zh: "通用资料知识库",
      en: "General Source Knowledge Base"
    },
    shortTitle: {
      zh: "通用资料",
      en: "General Sources"
    },
    summary: {
      zh: "适合手册、制度、讲义、Office/WPS、PDF、图片、表格和文本混合目录。",
      en: "For manuals, policies, handouts, Office/WPS files, PDFs, images, spreadsheets, and text folders."
    },
    commercialFit: {
      zh: "面向企业制度、客服知识、培训资料和项目文档的通用商用模板。",
      en: "For business policies, support knowledge, training material, and project documents."
    },
    bestFor: [
      {
        zh: "来源格式混合，但需要统一问答和引用的资料夹。",
        en: "Mixed-format folders that need unified Q&A and citations."
      },
      {
        zh: "企业制度、操作手册、培训课件和产品文档。",
        en: "Policies, SOPs, training decks, and product documents."
      }
    ],
    notFor: [
      {
        zh: "强结构化数据库、实时业务系统或需要按权限实时查询的场景。",
        en: "Highly structured databases, live business systems, or scenarios requiring live permission checks."
      }
    ],
    defaultPaths: {
      source: "source",
      work: "workspace"
    },
    requiredFields: [
      { key: "source.root", label: { zh: "资料目录", en: "Source folder" }, required: true },
      { key: "workspace.root", label: { zh: "工作目录", en: "Work folder" }, required: true },
      { key: "metadata.domain", label: { zh: "业务领域", en: "Business domain" }, required: false },
      { key: "metadata.owner", label: { zh: "资料负责人", en: "Content owner" }, required: false }
    ],
    metadataFields: [
      "domain",
      "owner",
      "document_type",
      "title",
      "section",
      "version",
      "effective_date",
      "page_start",
      "page_end",
      "source_uri"
    ],
    metadataContract: {
      requiredForSearch: ["domain", "document_type", "version", "section"],
      requiredForCitation: ["document_id", "version_id", "sourceUri", "page_start", "page_end", "excerpt"],
      optionalButRecommended: ["owner", "effective_date", "department", "policy_id"],
      queryFilters: [
        { zh: "业务领域", en: "Domain" },
        { zh: "文档类型", en: "Document type" },
        { zh: "版本", en: "Version" },
        { zh: "章节", en: "Section" },
        { zh: "负责人", en: "Owner" }
      ],
      summary: {
        zh: "通用模板优先用领域、文档类型、版本和章节筛选, 再用引用片段确认答案来源。",
        en: "The general template filters by domain, document type, version, and section first, then confirms answers with cited excerpts."
      }
    },
    organizationRules: [
      {
        zh: "优先按标题、章节、列表和页面边界整理，避免只按字数切开。",
        en: "Prefer headings, sections, lists, and page boundaries instead of splitting only by length."
      },
      {
        zh: "文档标题、版本、发布日期和负责人进入元数据，便于后续筛选。",
        en: "Document title, version, publish date, and owner become metadata for later filtering."
      }
    ],
    domainProcessingPolicy: {
      unitOfMeaning: "business-section",
      versionHandling: "active-version-with-history",
      linkHandling: "metadata-only",
      chunkingBasis: {
        zh: "优先按标题层级、流程步骤、条款、表格和页面边界组织, 不只按字数切开。",
        en: "Prefer headings, process steps, clauses, tables, and page boundaries instead of splitting only by length."
      },
      validationFocus: {
        zh: "确认当前版本、流程步骤、例外条款、表格和来源位置可追溯。",
        en: "Ensure active version, process steps, exceptions, tables, and source locations remain traceable."
      }
    },
    modalityPolicy: {
      table: {
        action: "structure-or-review",
        preferredFormat: "markdown-or-json",
        zh: "业务表格保留表头、行列关系和适用条件。",
        en: "Business tables keep headers, row/column relationships, and applicability conditions."
      },
      workflow: {
        keepStepsTogether: true,
        zh: "流程步骤、责任人、条件和例外不能被拆到不同片段。",
        en: "Workflow steps, owners, conditions, and exceptions must not be split across unrelated chunks."
      },
      attachment: {
        action: "metadata-or-linked-source",
        zh: "附件清单不直接污染正文; 可追溯附件作为来源关联。",
        en: "Attachment lists do not pollute body text; traceable attachments are linked as sources."
      }
    },
    chunkingPolicy: {
      strategy: {
        zh: "文档结构优先, 段落和语义长度兜底。",
        en: "Document structure first, paragraphs and semantic length as fallback."
      },
      targetSize: {
        zh: "每片约 500-900 个中文字符, 流程步骤和表格保持完整。",
        en: "About 500-900 Chinese characters per chunk; keep process steps and tables intact."
      },
      overlap: {
        zh: "同一标题下保留少量上下文, 不跨版本或制度编号合并。",
        en: "Keep light context within the same heading; do not merge across versions or policy IDs."
      },
      preserve: [
        { zh: "标题层级、版本号、发布日期和负责人。", en: "Heading hierarchy, version, publish date, and owner." },
        { zh: "流程步骤、例外条款、表格和可执行说明。", en: "Process steps, exceptions, tables, and actionable instructions." },
        { zh: "来源文件路径和外部链接元数据。", en: "Source file path and external-link metadata." }
      ]
    },
    qualityGates: [
      { zh: "回答必须能引用到文件、标题或页码位置。", en: "Answers must cite file, heading, or page/location." },
      { zh: "旧制度、重复免责声明、导航和附件清单不能污染正文。", en: "Old policies, repeated disclaimers, navigation, and attachment lists must not pollute body text." },
      { zh: "个人信息、客户信息、价格和密钥默认进入待确认。", en: "Personal data, customer data, pricing, and secrets go to review by default." }
    ],
    pitfalls: [
      { zh: "制度和手册经常多版本并存, 版本号缺失会导致回答引用旧文件。", en: "Policies and manuals often have multiple versions; missing version metadata can cite stale files." },
      { zh: "外部链接不代表已抓取内容, 只能作为来源元数据保留。", en: "External links do not mean linked content was crawled; keep them as source metadata only." },
      { zh: "表格、清单和流程图如果被纯字数切开, 检索结果会缺上下文。", en: "Tables, lists, and flow diagrams lose context when split only by character count." }
    ],
    acceptanceCriteria: [
      { zh: "模板问题能返回原文片段和来源位置。", en: "Template questions return source excerpt and location." },
      { zh: "过滤报告能列出外部链接、疑似敏感信息和被删除噪声。", en: "The filter report lists external links, possible sensitive data, and removed noise." },
      { zh: "抽检同一主题的多版本资料, 默认使用当前版本并保留旧版本。", en: "Multi-version samples use the current version by default while preserving older versions." }
    ],
    vectorFilterPolicy: {
      label: {
        zh: "进入检索库前过滤",
        en: "Filtering Before Search Library"
      },
      remove: [
        {
          zh: "导航菜单、重复页脚、下载提示、页码孤行和空白占位。",
          en: "Navigation menus, repeated footers, download prompts, isolated page numbers, and blank placeholders."
        },
        {
          zh: "长串无意义符号、断裂 URL、重复免责声明和无上下文附件清单。",
          en: "Meaningless symbol runs, broken URLs, repeated disclaimers, and attachment lists without context."
        }
      ],
      metadataOnly: [
        {
          zh: "文档版本、发布日期、负责人、文件路径和外部链接。",
          en: "Document version, publish date, owner, file path, and external links."
        },
        {
          zh: "页眉里的部门、分类和制度编号。",
          en: "Department, category, and policy number from headers."
        }
      ],
      keep: [
        {
          zh: "正文规则、流程步骤、定义、例外条款、表格和可执行说明。",
          en: "Policy text, process steps, definitions, exceptions, tables, and actionable instructions."
        }
      ],
      review: [
        {
          zh: "疑似个人信息、客户信息、合同价格、访问密钥和提示注入内容。",
          en: "Possible personal data, customer data, contract pricing, access keys, and prompt-injection content."
        }
      ],
      reportFields: [
        "document_id",
        "page_number",
        "rule_id",
        "action",
        "original_text",
        "reason",
        "confidence",
        "review_required"
      ]
    },
    safetyGates: [
      { zh: "含敏感信息的资料默认要求用户确认。", en: "Sources with sensitive information require confirmation by default." },
      { zh: "外部链接不自动抓取，只记录来源。", en: "External links are recorded but not crawled automatically." },
      { zh: "写入检索库前必须展示过滤报告。", en: "Show the filter report before writing to the search library." }
    ],
    evaluationQuestions: [
      {
        zh: "这份制度的适用范围是什么？请引用原文。",
        en: "What is the scope of this policy? Cite the source text."
      },
      {
        zh: "某流程的第一步和审批人是谁？",
        en: "What is the first step of the process and who approves it?"
      }
    ],
    updatePolicy: {
      zh: "按文件指纹和版本号识别更新，旧版本保留用于审计和回滚。",
      en: "Use file fingerprints and version labels to detect updates; keep older versions for audit and rollback."
    },
    migrationPolicy: {
      zh: "模板升级时保留字段映射和过滤报告，避免旧引用失效。",
      en: "Template upgrades preserve field mappings and filter reports so old citations remain valid."
    }
  }
];

export function listTemplates() {
  return templates.map(summarizeTemplate);
}

export function getTemplate(templateId) {
  return templates.find((template) => template.id === templateId) || null;
}

export function getTemplateLibrary() {
  return {
    ok: true,
    version: templateLibraryVersion,
    templates: listTemplates()
  };
}

export function summarizeTemplate(template) {
  return {
    id: template.id,
    version: template.version,
    status: template.status,
    recommended: template.recommended,
    supportedModes: template.supportedModes,
    defaultMode: template.defaultMode,
    templateRole: template.templateRole,
    extendsTemplate: template.extendsTemplate,
    coreName: template.coreName,
    expertId: template.expertId ?? null,
    expertName: template.expertName,
    title: template.title,
    shortTitle: template.shortTitle,
    summary: template.summary,
    commercialFit: template.commercialFit,
    defaultPaths: template.defaultPaths,
    requiredFields: template.requiredFields,
    metadataFields: template.metadataFields,
    archivePolicy: template.archivePolicy,
    processingInputPolicy: template.processingInputPolicy,
    citationPolicy: template.citationPolicy,
    aliyunMetadataContract: template.aliyunMetadataContract,
    metadataContract: template.metadataContract,
    domainProcessingPolicy: template.domainProcessingPolicy,
    modalityPolicy: template.modalityPolicy,
    vectorFilterPolicy: template.vectorFilterPolicy,
    chunkingPolicy: template.chunkingPolicy,
    qualityGates: template.qualityGates,
    pitfalls: template.pitfalls,
    acceptanceCriteria: template.acceptanceCriteria,
    safetyGates: template.safetyGates,
    evaluationQuestions: template.evaluationQuestions,
    updatePolicy: template.updatePolicy,
    migrationPolicy: template.migrationPolicy
  };
}
