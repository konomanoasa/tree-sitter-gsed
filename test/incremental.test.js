import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertIncrementalContract,
  issueSignatures,
  parse,
  parseSuccessfully,
} from "./support/parser.js";

for (const scope of ["source.gsed", "source.gsed.ere"]) {
  const group = scope.endsWith("ere") ? "(a|b)+" : "\\(a\\|b\\)\\+";

  for (const source of [
    `s/${group}/\\U&/g\np\n`,
    "{\n/ab/Ip;a hello\n}\n",
    "s/\\x5ba\\x5d/x/\n",
    "s/\\xce\\xa3*/x/\n",
    String.raw`s\b\X\p`,
    String.raw`y\abc\xyz\;p`,
    String.raw`\\b\p`,
    "a x\\t\\",
    "a x\\c\\.\\",
    "a x\\t\\\ny\\n\\",
    "e x\\t\\",
    "e\\\nx\\t",
    "e\\\\t\\",
    "a\\\\\\",
    "e\\\\\\",
    String.raw`e x\c\y`,
    String.raw`s5\x6\55X5p`,
    String.raw`s5\x6\65X5p`,
    String.raw`s5\x\5ba\x\5d5X5`,
    "p;   ,2p",
    "{   ,2p}",
  ]) {
    test(`${scope}: deletion and restoration in ${JSON.stringify(source)}`, () => {
      const expected = parseSuccessfully(scope, source);
      for (let byte = 0; byte < Buffer.byteLength(source); byte++) {
        const edits = [{ byte, deleteBytes: 1, insert: "" }];
        const edited = applyEdits(source, edits);
        const fresh = parse(scope, edited);
        assertIncrementalContract(
          fresh,
          parse(scope, source, edits),
          `delete byte ${byte}`,
        );
        const restored = [{ byte, deleteBytes: 0, insert: source[byte] }];
        assertIncrementalContract(
          expected,
          parse(scope, edited, restored),
          `restore byte ${byte}`,
        );
      }
    });
  }

  test(`${scope}: reused bracket atoms follow the range operator decision`, () => {
    for (const [source, byte] of [
      ["/[Nabt-\\x5d", 10],
      ["/[Nab[.t.]-\\x5d", 14],
      ["/[Nab\\xce-\\x5d", 13],
      ["/[Nab[-\\x5d", 10],
    ]) {
      const edits = [
        { byte: 2, deleteBytes: 1, insert: "N" },
        { byte, deleteBytes: 1, insert: "" },
      ];
      assertIncrementalContract(
        parse(scope, applyEdits(source, edits)),
        parse(scope, source, edits),
        `${JSON.stringify(source)} ${JSON.stringify(edits)}`,
      );
    }
  });

  test(`${scope}: appending source through incomplete states`, () => {
    for (const source of [
      "s/[[:alpha:]]/word/g\n",
      "0~2p;0,/a/p\n",
      "3,0~4p\n",
      "/[[....]]/p\n",
      "/[[:alpha:]-]/p\n",
      "/[a-b-]/p\n",
    ]) {
      for (let end = 1; end <= source.length; end++) {
        const before = source.slice(0, end - 1);
        const edits = [
          { byte: end - 1, deleteBytes: 0, insert: source[end - 1] },
        ];
        const fresh = parse(scope, source.slice(0, end));
        assert.deepEqual(
          issueSignatures(fresh.nodes).filter(
            ({ outcome }) => outcome !== "incomplete_syntax",
          ),
          [],
          `${JSON.stringify(source.slice(0, end))} has determined issues`,
        );
        assertIncrementalContract(
          fresh,
          parse(scope, before, edits),
          `prefix ${end} of ${JSON.stringify(source)}`,
        );
      }
    }
    assert.equal(
      applyEdits("a", [{ byte: 1, deleteBytes: 0, insert: "b" }]).toString(),
      "ab",
    );
  });

  test(`${scope}: optional operands after a zero step range follow appended text`, () => {
    for (const [source, insert, field] of [
      ["0~0,/a/e ", ";", "command"],
      ["0~0,/a/b ", "x", "label"],
      ["0~0,/a/T ", "x", "label"],
      ["0~0,/a/v ", "4", "version"],
      ["0~,/a/l ", "5", "argument"],
    ]) {
      const edits = [
        { byte: Buffer.byteLength(source), deleteBytes: 0, insert },
      ];
      const fresh = parseSuccessfully(scope, applyEdits(source, edits));
      assert.deepEqual(issueSignatures(fresh.nodes), []);
      assert.ok(fresh.nodes.some((node) => node.field === field));
      assertIncrementalContract(
        fresh,
        parseSuccessfully(scope, source, edits),
        `${JSON.stringify(source)} + ${JSON.stringify(insert)}`,
      );
    }
  });

  test(`${scope}: zero address validity survives edits around nested zero addresses`, () => {
    for (const { source, edits } of [
      {
        source: "00~0,//{$!\n0~!;0;$y",
        edits: [{ byte: 0, deleteBytes: 3, insert: "" }],
      },
      {
        source: "0,//{$!\n0~!;0;$y",
        edits: [{ byte: 0, deleteBytes: 0, insert: "00~" }],
      },
      {
        source: "0,/a/{p;0,/b/{0~0,/c/p}}",
        edits: [{ byte: 1, deleteBytes: 4, insert: "q" }],
      },
    ]) {
      assertIncrementalContract(
        parseSuccessfully(scope, applyEdits(source, edits)),
        parseSuccessfully(scope, source, edits),
        `${JSON.stringify(source)} ${JSON.stringify(edits)}`,
      );
    }
    assert.deepEqual(
      issueSignatures(
        parseSuccessfully(scope, "0,//{$!\n0~!;0;$y").nodes,
      ).filter(({ reason }) => reason === "invalid_zero_address"),
      [
        {
          outcome: "invalid_syntax",
          reason: "invalid_zero_address",
          range: "[1, 0] - [1, 1]",
        },
        {
          outcome: "invalid_syntax",
          reason: "invalid_zero_address",
          range: "[1, 4] - [1, 5]",
        },
      ],
    );
  });

  test(`${scope}: address and opaque operand edits preserve incremental CST`, () => {
    for (const source of [
      "b;t;T;e\n",
      ":x p\nb x#hi\n",
      "v0alpha p\n",
      "\rp;\vp;\fp",
      "s[\\c[[x[",
      "s/[:alpha:]/x/",
      "s/[^\\x3aalpha:\\x5d]/x/",
      "\\Σp\n",
      "\\\np\n",
      "0,/a/p\n",
      "0r file\n",
      "1,2q\n",
      ",2q\n",
      "1/a/p\n",
      "p\0p\n",
      "!#c\np\n",
      ":loop; b loop\n",
      "#n hi\na text\n",
      "\r#n\n:",
      "w file;p\n",
      "s/[[:\\x61lpha:]]/x/\n",
      "s/[\\x5b\\x3aalpha\\x3a\\x5d]/x/\n",
      "s$\\$$x$",
      "s/[a-\\x5d]/x/",
      "s@[a\\x5d@]@x@",
      "s/\\x5b/x/",
      "s/[a-b-c]/x/",
      "s/[a-[=z=]]/x/",
    ]) {
      for (let byte = 0; byte < source.length; byte++) {
        const edits = [{ byte, deleteBytes: 1, insert: "" }];
        assertIncrementalContract(
          parse(scope, applyEdits(source, edits)),
          parse(scope, source, edits),
          `${JSON.stringify(source)} delete ${byte}`,
        );
      }
    }
  });

  for (const [prefix, suffix, owner] of [
    ["s", ";p", "substitute_command"],
    ["y", ";p", "translate_command"],
    ["\\", "p", "regex_address"],
    ["1", ";p", "command"],
    ["!", ";p", "command"],
    ["s/a/x/", "p", "substitution_flags"],
  ]) {
    test(`${scope}: invalid UTF-8 at ${owner} syntax boundary`, () => {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from([255, 254]),
        Buffer.from(suffix),
      ]);
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        ["invalid_encoding"],
        result.stdout,
      );
      const issue = result.nodes.find((node) => node.kind === "syntax_issue");
      assert.equal(result.nodes[issue.parent].kind, owner, result.stdout);
      assert.deepEqual(
        [issue.startByte, issue.endByte],
        [prefix.length, prefix.length + 2],
      );
      for (const byte of [prefix.length, prefix.length + 1]) {
        const edits = [{ byte, deleteBytes: 1, insert: "" }];
        assertIncrementalContract(
          parse(scope, applyEdits(source, edits)),
          parse(scope, source, edits),
          `${prefix} invalid byte ${byte}`,
        );
      }
    });
  }

  for (const [prefix, bytes] of [
    ["", [255, 0xce, 0xa3]],
    [":", [255, 0xce, 0xa3]],
    ["s/", [255, 0xce, 0xa3]],
    ["s/a/", [255, 0xce, 0xa3]],
    ["s/[\\", [0xce, 0xa3]],
  ]) {
    test(`${scope}: editing UTF-8 after ${JSON.stringify(prefix)} preserves incremental CST`, () => {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from(bytes),
        Buffer.from("\n"),
      ]);
      const byte = prefix.length + bytes.length - 1;
      for (const [deleteBytes, insert] of [
        [1, ""],
        [0, "x"],
      ]) {
        const edits = [{ byte, deleteBytes, insert }];
        assertIncrementalContract(
          parse(scope, applyEdits(source, edits)),
          parse(scope, source, edits),
          `${JSON.stringify(edits)}`,
        );
      }
    });
  }

  test(`${scope}: optional operand after a missing range end preserves incremental CST`, () => {
    for (const [source, insert] of [
      ["1,e ", "x"],
      ["1,b ", "x"],
      ["1,l ", "5"],
    ]) {
      const edits = [{ byte: source.length, deleteBytes: 0, insert }];
      assertIncrementalContract(
        parse(scope, applyEdits(source, edits)),
        parse(scope, source, edits),
        `${JSON.stringify(source)} + ${JSON.stringify(insert)}`,
      );
    }
  });

  test(`${scope}: leading layout preserves empty scripts and directive placement`, () => {
    for (const source of [" ", "\t ", " p", "  !p", "  #n", "\n   "]) {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), []);
      assert.equal(
        nodes.some(({ kind }) => kind === "directive"),
        false,
      );
    }
    for (const edits of [
      [{ byte: 0, deleteBytes: 0, insert: " " }],
      [
        { byte: 0, deleteBytes: 0, insert: " " },
        { byte: 0, deleteBytes: 1, insert: "" },
      ],
    ]) {
      const source = "#n\np";
      assertIncrementalContract(
        parseSuccessfully(scope, applyEdits(source, edits)),
        parseSuccessfully(scope, source, edits),
        "leading layout",
      );
    }
  });

  for (const { source, outcome, suffix } of [
    {
      source: String.raw`/[[:a\c`,
      outcome: "incomplete_syntax",
      suffix: ",pha:]]/p",
    },
    { source: "/[[:a\\", outcome: "incomplete_syntax", suffix: "x6cpha:]]/p" },
    {
      source: String.raw`/[[:a\x6`,
      outcome: "incomplete_syntax",
      suffix: "cpha:]]/p",
    },
    {
      source: String.raw`/[[:a\o1`,
      outcome: "incomplete_syntax",
      suffix: "54pha:]]/p",
    },
    {
      source: String.raw`/[[:a\d1`,
      outcome: "incomplete_syntax",
      suffix: "08pha:]]/p",
    },
    {
      source: String.raw`/[[:a\x`,
      outcome: "incomplete_syntax",
      suffix: "6cpha:]]/p",
    },
    { source: String.raw`/[[:z\c`, outcome: "invalid_syntax", suffix: null },
    { source: String.raw`/[[:a\xF`, outcome: "invalid_syntax", suffix: null },
    { source: String.raw`/[[:alph\d97`, outcome: null, suffix: ":]]/p" },
    { source: String.raw`/[[:alpha\d58`, outcome: null, suffix: null },
  ]) {
    test(`${scope}: character class escape completion ${JSON.stringify(source)}`, () => {
      const result = parseSuccessfully(scope, source);
      const issues = issueSignatures(result.nodes).filter(
        ({ reason }) => reason === "unknown_character_class",
      );
      assert.deepEqual(
        issues.map((issue) => issue.outcome),
        outcome ? [outcome] : [],
      );
      if (suffix !== null) {
        const edits = [
          { byte: Buffer.byteLength(source), deleteBytes: 0, insert: suffix },
        ];
        const fresh = parseSuccessfully(scope, applyEdits(source, edits));
        assert.deepEqual(issueSignatures(fresh.nodes), []);
        assertIncrementalContract(
          fresh,
          parseSuccessfully(scope, source, edits),
          source,
        );
      }
    });
  }

  test(`${scope}: boundary decisions survive edits`, () => {
    for (const { source, byte, deleteBytes, insert } of [
      { source: "{p;!}", byte: 3, deleteBytes: 0, insert: "1" },
      { source: "{p;1!}", byte: 3, deleteBytes: 1, insert: "" },
      { source: "{p;1!}", byte: 5, deleteBytes: 1, insert: "" },
      { source: "1, p", byte: 2, deleteBytes: 0, insert: "2" },
      { source: "1,2,  p", byte: 4, deleteBytes: 0, insert: "3" },
      { source: ":\0x", byte: 1, deleteBytes: 0, insert: "a" },
      { source: ":a\0x", byte: 1, deleteBytes: 1, insert: "" },
      {
        source: String.raw`s/\x5c\\x5e/x/`,
        byte: 7,
        deleteBytes: 1,
        insert: "",
      },
      {
        source: String.raw`s/\x5c\x5e/x/`,
        byte: 7,
        deleteBytes: 0,
        insert: "\\",
      },
    ]) {
      const edits = [{ byte, deleteBytes, insert }];
      const fresh = parseSuccessfully(scope, applyEdits(source, edits));
      assertIncrementalContract(
        fresh,
        parseSuccessfully(scope, source, edits),
        JSON.stringify([source, edits]),
      );
    }
  });

  test(`${scope}: review boundary edits agree with fresh parsing`, () => {
    for (const { source, byte, deleteBytes, insert } of [
      { source: "ax\\c\\", byte: 5, deleteBytes: 0, insert: "." },
      { source: "ax\\c\\.", byte: 5, deleteBytes: 0, insert: "\\" },
      { source: "r x\0tail", byte: 2, deleteBytes: 1, insert: "" },
      { source: "s\0", byte: 1, deleteBytes: 1, insert: "/" },
      { source: "0~0", byte: 3, deleteBytes: 0, insert: "r x" },
      { source: "0~0,", byte: 4, deleteBytes: 0, insert: "/a/p" },
      { source: "0~0r x", byte: 2, deleteBytes: 1, insert: "2" },
    ]) {
      const edits = [{ byte, deleteBytes, insert }];
      assertIncrementalContract(
        parseSuccessfully(scope, applyEdits(source, edits)),
        parseSuccessfully(scope, source, edits),
        source,
      );
    }
  });

  test(`${scope}: incomplete control backslash can be completed at EOF`, () => {
    const source = "s/\\c\\";
    const before = parseSuccessfully(scope, source);
    assert.deepEqual(
      issueSignatures(before.nodes).filter(
        ({ reason }) => reason === "invalid_control_escape",
      ),
      [
        {
          outcome: "incomplete_syntax",
          reason: "invalid_control_escape",
          range: "[0, 2] - [0, 5]",
        },
      ],
    );
    const edits = [{ byte: 5, deleteBytes: 0, insert: "\\./x/" }];
    const fresh = parseSuccessfully(scope, applyEdits(source, edits));
    assert.deepEqual(issueSignatures(fresh.nodes), []);
    assertIncrementalContract(
      fresh,
      parseSuccessfully(scope, source, edits),
      source,
    );
  });

  test(`${scope}: address and control escape edits preserve the public CST`, () => {
    for (const { source, byte, deleteBytes, insert } of [
      { source: "+p", byte: 1, deleteBytes: 0, insert: "3" },
      { source: "+3p", byte: 1, deleteBytes: 1, insert: "0" },
      { source: "+0p", byte: 1, deleteBytes: 1, insert: "" },
      { source: "1,+p", byte: 3, deleteBytes: 0, insert: "2" },
      { source: "1~2p", byte: 2, deleteBytes: 1, insert: "" },
      { source: String.raw`s/\c\./x/`, byte: 5, deleteBytes: 0, insert: "\\" },
      { source: String.raw`s/\c\\./x/`, byte: 5, deleteBytes: 1, insert: "" },
      { source: String.raw`s/\c\\c/x/`, byte: 6, deleteBytes: 1, insert: "." },
      { source: String.raw`sc\c\.cxc`, byte: 1, deleteBytes: 1, insert: "/" },
      {
        source: String.raw`sx\c\\\\x5dxYx`,
        byte: 7,
        deleteBytes: 1,
        insert: "",
      },
      {
        source: String.raw`sx\c\\\x5dxYx`,
        byte: 7,
        deleteBytes: 0,
        insert: "\\",
      },
      { source: "s/\\c\\\\\\\\\n/x/", byte: 7, deleteBytes: 1, insert: "" },
      { source: "s/\\c\\\\\\\n/x/", byte: 6, deleteBytes: 0, insert: "\\" },
    ]) {
      const edits = [{ byte, deleteBytes, insert }];
      const fresh = parseSuccessfully(scope, applyEdits(source, edits));
      assertIncrementalContract(
        fresh,
        parseSuccessfully(scope, source, edits),
        JSON.stringify({ source, edits }),
      );
    }
  });
}

for (const [scope, pattern, reason, leaf, spelling] of [
  ["source.gsed", "\\)", "unmatched_group_close", "group_close", "\\)"],
  [
    "source.gsed",
    "\\x5c)",
    "unmatched_group_close",
    "character_escape",
    "\\x5c)",
  ],
  ["source.gsed.ere", ")", "unmatched_group_close", "group_close", ")"],
  [
    "source.gsed.ere",
    "\\x29",
    "unmatched_group_close",
    "character_escape",
    "\\x29",
  ],
  ["source.gsed.ere", "*", "invalid_regex_operator", "regex_operator", "*"],
  [
    "source.gsed.ere",
    "\\x2a",
    "invalid_regex_operator",
    "character_escape",
    "\\x2a",
  ],
  ["source.gsed.ere", "{2}", "invalid_regex_operator", "interval_open", "{"],
  [
    "source.gsed.ere",
    "\\x7b2}",
    "invalid_regex_operator",
    "character_escape",
    "\\x7b",
  ],
]) {
  test(`${scope}: ${reason} retains ${JSON.stringify(spelling)}`, () => {
    const source = `s/${pattern}/x/`;
    const result = parseSuccessfully(scope, source);
    assert.deepEqual(
      issueSignatures(result.nodes).map((issue) => issue.reason),
      [reason],
    );
    const issueIndex = result.nodes.findIndex((node) => node.kind === reason);
    const child = result.nodes[issueIndex + 1];
    assert.equal(child.parent, issueIndex);
    assert.equal(child.kind, leaf);
    assert.equal(source.slice(child.startByte, child.endByte), spelling);
    if (pattern.endsWith("2}")) {
      assert.equal(
        result.nodes[result.nodes[issueIndex - 2].parent].kind,
        "interval",
      );
      assert.equal(
        result.nodes.find((node) => node.kind === "number").startByte,
        2 + spelling.length,
      );
      assert.equal(
        result.nodes.filter((node) => node.kind === "interval_close").length,
        1,
      );
    }
    for (let byte = 0; byte < source.length; byte++) {
      const edits = [{ byte, deleteBytes: 1, insert: "" }];
      assertIncrementalContract(
        parse(scope, applyEdits(source, edits)),
        parse(scope, source, edits),
        `delete ${byte} in ${source}`,
      );
    }
  });
}

test("source.gsed: literal interval lookahead survives edits and EOF completion", () => {
  for (const { source, byte, deleteBytes, insert } of [
    { source: String.raw`s/a\b\{1\}/x/`, byte: 7, deleteBytes: 1, insert: "x" },
    { source: String.raw`s/a\b\{x\}/x/`, byte: 7, deleteBytes: 1, insert: "1" },
    { source: String.raw`s/\b\{/x/`, byte: 2, deleteBytes: 0, insert: "a" },
    {
      source: String.raw`s/a\b\{`,
      byte: 7,
      deleteBytes: 0,
      insert: String.raw`1\}/x/`,
    },
    {
      source: String.raw`s/a\b\{1`,
      byte: 8,
      deleteBytes: 0,
      insert: String.raw`\}/x/`,
    },
  ]) {
    const edits = [{ byte, deleteBytes, insert }];
    assertIncrementalContract(
      parseSuccessfully("source.gsed", applyEdits(source, edits)),
      parseSuccessfully("source.gsed", source, edits),
      source,
    );
  }
  assert.deepEqual(
    issueSignatures(
      parseSuccessfully("source.gsed", String.raw`s/a\b\{`).nodes,
    ).filter(({ reason }) => reason === "invalid_interval_syntax"),
    [
      {
        outcome: "incomplete_syntax",
        reason: "invalid_interval_syntax",
        range: "[0, 5] - [0, 7]",
      },
    ],
  );
});
