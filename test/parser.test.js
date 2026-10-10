import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import {
  issueSignatures,
  parseSuccessfully,
  parseSummary,
} from "./support/parser.js";

const cases = [
  { name: "empty script", source: "", kinds: ["script"] },
  {
    name: "simple commands and block",
    source: "1,3!{p;d}\n",
    kinds: ["block", "address_clause", "negation"],
  },
  {
    name: "substitution and flags",
    source: "s/a/b/2g\n",
    kinds: [
      "substitute_command",
      "regular_expression",
      "replacement",
      "substitution_flags",
    ],
  },
  {
    name: "GNU addresses and modifiers",
    source: "0,/a/Ip;1~2p;3,+2d;4,~3p\n",
    kinds: ["regex_address", "relative_address", "address_modifier"],
  },
  {
    name: "labels separated by semicolons",
    source: ": loop ; b loop; T loop; t loop\n",
    kinds: ["label_command", "branch_command", "label"],
  },
  {
    name: "inline and continued text",
    source: "a hello; world\n2i\\\none\\\ntwo\nc changed\n",
    kinds: ["text_command", "text", "line_continuation"],
  },
  {
    name: "filenames own semicolons",
    source: "r file;name\nR next\nw output\nW first\n",
    kinds: ["filename", "file_command"],
  },
  {
    name: "GNU command arguments",
    source: "q42;Q0;l80;v4.10\ne printf ok; printf done\nF;z\n",
    kinds: [
      "numeric_command",
      "version_command",
      "execute_command",
      "shell_command",
    ],
  },
  {
    name: "translation escapes",
    source: "y/abc/xyz/\n",
    kinds: ["translate_command", "translation_string"],
  },
  {
    name: "replacement case conversion",
    source: "s/a/\\U&\\E\\1\\t/ep\n",
    kinds: [
      "case_conversion",
      "matched_text_reference",
      "replacement_reference",
      "character_escape",
    ],
  },
  {
    name: "character classes and ranges",
    source: "/[[:alpha:]a-z]/p\n",
    kinds: ["character_class", "range", "bracket_expression"],
  },
  {
    name: "numeric escapes construct syntax",
    source: "s/\\x5e\\x5ba\\x5d/x/\n",
    kinds: ["anchor", "bracket_expression", "character_escape"],
  },
  {
    name: "delimiter inside bracket",
    source: "s/[/]/x/\n",
    kinds: ["bracket_expression"],
  },
];

for (const scope of ["source.gsed", "source.gsed.ere"]) {
  for (const { name, source, kinds } of cases) {
    test(`${scope}: ${name}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(result.nodes), [], result.stdout);
      for (const kind of kinds)
        assert.ok(
          result.nodes.some((node) => node.kind === kind),
          `${kind}\n${result.stdout}`,
        );
    });
  }

  for (const [source, expected] of [
    ["s/a/b/gg", ["duplicate_substitution_flag"]],
    ["s/a/b/pp", ["duplicate_substitution_flag"]],
    ["s/a/b/2p3", ["duplicate_substitution_flag"]],
    ["s/a/b/2 0;p", ["duplicate_substitution_flag", "zero_occurrence"]],
    ["s/a/b/0", ["zero_occurrence"]],
    ["s/a/b/k", ["unknown_substitution_flag"]],
    ["s//b/i", ["modifier_on_empty_regexp"]],
    ["//Mp", ["modifier_on_empty_regexp"]],
    ["s/[[:unknown:]]/b/", ["unknown_character_class"]],
    ["!!p", ["duplicate_negation"]],
    ["}p", ["unmatched_closing_brace"]],
    ["s/a/b/pep", []],
    ["s/a/b/eeII", []],
    ["s/a/b/wfile;p\n", []],
    ["p#x\n", []],
    ["a\\", []],
    ["a\np", []],
  ]) {
    test(`${scope}: GNU classification ${JSON.stringify(source)}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        expected,
        result.stdout,
      );
    });
  }

  for (const [source, expected] of [
    ["b", []],
    ["t\n", []],
    ["T;", []],
    ["e", []],
    ["e x\\\npp", []],
    ["e x\\\\\npp", ["missing_command_separator"]],
    ["e x\\\\\\\npp", []],
    ["i\\\\\n\\bb", ["missing_command"]],
    ["a x\\c\\\\\n1\np", ["missing_command"]],
    ["b#comment", []],
    [":#comment", ["missing_operand"]],
    ["\\Σp", ["invalid_delimiter"]],
    ["\\", ["missing_opening_delimiter", "missing_command"]],
    ["\\\np", ["missing_opening_delimiter", "missing_command"]],
    ["\rp;\vp;\fp", []],
    ["{\rp}", []],
    ["1\rp", ["unknown_command", "missing_command_separator"]],
    ["1/a/p", ["unknown_command", "missing_command_separator"]],
    ["1 2p", ["unknown_command", "missing_command_separator"]],
    ["$!$p", ["unknown_command", "missing_command_separator"]],
    ["!,", ["unknown_command"]],
    ["1\\", ["unknown_command"]],
    ["\0", ["unknown_command"]],
    ["1S", ["unknown_command"]],
    ["p\0", ["missing_command_separator", "unknown_command"]],
    ["s/a/b/\r", ["unknown_substitution_flag"]],
    ["s/\\c[/x/", []],
    ["s[\\c[[x[", []],
    ["s/[:alpha:]/x/", ["misplaced_character_class"]],
    ["s/[^:alpha:]/x/", ["misplaced_character_class"]],
    ["s/[:unknown:]/x/", ["misplaced_character_class"]],
    ["s/[::]/x/", []],
    ["s/[:::]/x/", []],
    ["s/[:\\x3a:]/x/", []],
    ["s/[[...]]/x/", ["unterminated_regex", "unterminated_operand"]],
    ["s/[:a-b:]/x/", []],
    ["s/[:[alpha:]/x/", ["misplaced_character_class"]],
    ["s/[:[:alpha:]:]/x/", []],
    ["s/[a:alpha:]/x/", []],
    ["s/[:alpha:x]/x/", []],
    ["0r file\n", []],
    ["0~2p", []],
    ["0~10r x", []],
    ["0~100,/b/p", []],
    ["0,/a/p", []],
    ["0p", ["invalid_zero_address"]],
    ["0!r file\n", ["invalid_zero_address"]],
    ["0,1p", ["invalid_zero_address"]],
    ["1,0p", ["invalid_zero_address"]],
    ["0~0p", ["invalid_zero_address"]],
    ["1,2q", ["excess_address"]],
    [",2q", ["missing_address", "excess_address"]],
    [",q", ["missing_address", "excess_address", "missing_address"]],
    ["1,2,3p", ["excess_address"]],
    ["1:label", ["excess_address"]],
    ["1#comment", ["excess_address"]],
    ["!#comment", []],
    ["p\n1!#comment\n", ["excess_address"]],
    ["p\n!#comment\n", []],
    [",2p", ["missing_address"]],
    ["1,p", ["missing_address"]],
    ["1~p", []],
    ["1,+p", []],
    ["s a b ", []],
    ["y ab cd ", []],
    ["s/\0/x/", []],
    ["s/\\xff/x/", []],
    ["s/\\x00/x/", []],
    ["s/[\\x5c*]/x/", []],
    ["s/[a\\x2dz]/x/", []],
    ["s/[[:\\x61lpha:]]/x/", []],
    ["s/[\\x5b\\x3aalpha\\x3a\\x5d]/x/", []],
    ["s/[[.\\x61.]]/x/", []],
    ["s/[[::]]/x/", ["missing_bracket_element"]],
    ["s/[[..]]/x/", ["missing_bracket_element"]],
    ["s/[a-b-c]/x/", ["invalid_range_operator"]],
    ["s/[[:alpha:]-z]/x/", ["invalid_range_endpoint"]],
    ["s/[a-[=z=]]/x/", ["invalid_range_endpoint"]],
    ["s/[a-[.z.]]/x/", []],
    ["s/[a-\\x5d]/x/", []],
    ["s@[a\\x5d@]@x@", []],
    ["s2\\x2x2", []],
    ["s2a2\\x2", []],
    ["s/a/\\c/", []],
    ["s/a/\\c\\\\/", []],
    ["sca\\ccYcg", ["unterminated_operand"]],
    ["s/\\c//x/", []],
    ["s/\\x5c/x/", ["missing_escape_character"]],
    ["s/\\x5b/x/", ["missing_bracket_element", "missing_closing_delimiter"]],
  ]) {
    test(`${scope}: boundary ${JSON.stringify(source)}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        expected,
        result.stdout,
      );
    });
  }

  for (const [name, source, kind, expected] of [
    [
      "escaped UTF-8 character",
      "s/\\xce\\xa3*/x/",
      "regex_character",
      [[2, 10]],
    ],
    [
      "overlong escaped UTF-8 is separate bytes",
      "s/\\xe0\\x80\\x80*/x/",
      "regex_character",
      [
        [2, 6],
        [6, 10],
        [10, 14],
      ],
    ],
    ["native UTF-8 character", "s/Σ*/x/", "regex_character", [[2, 4]]],
    ["escaped bracket range", "s/[a\\x2dz]/x/", "range", [[3, 9]]],
    [
      "escaped UTF-8 bracket element",
      "s/[\\xce\\xa3]/x/",
      "bracket_character",
      [[3, 11]],
    ],
    ["source spelling of anchor", "s/\\x5ea/x/", "character_escape", [[2, 6]]],
    [
      "source spelling of host delimiter escape",
      "s.\\..x.",
      "escape",
      [[2, 4]],
    ],
    [
      "directive preserves body whitespace",
      "#n hi\n",
      "comment_text",
      [[2, 5]],
    ],
    [
      "only first comment has directive role",
      "#n hi\n#n\n",
      "directive_text",
      [[0, 2]],
    ],
    [
      "initial BOM is input metadata",
      "\ufeff#n\np",
      "directive_text",
      [[3, 5]],
    ],
    ["embedded BOM is text", "a x\ufeffy\n", "literal", [[2, 7]]],
    [
      "digitless numeric escape retains source role",
      "s/\\x/x/",
      "escape",
      [[2, 4]],
    ],
    ["host escaped dollar anchor", "s$\\$$x$", "escape", [[2, 4]]],
    [
      "escaped delimiter inside an escape-opened bracket",
      "s/\\x5b\\/]/x/",
      "escape",
      [[6, 8]],
    ],
    [
      "escaped delimiter closes an escape-opened bracket",
      "s]\\x5ba\\]]x]",
      "escape",
      [[7, 9]],
    ],
    [
      "escaped delimiter as a range operator",
      "s-\\x5ba\\-z]-x-",
      "escape",
      [[7, 9]],
    ],
    [
      "escaped delimiters as character class markers",
      "s:\\x5b\\x5b\\:alpha\\:\\x5d\\x5d:x:",
      "escape",
      [
        [10, 12],
        [17, 19],
      ],
    ],
    ["escape letter delimiter in a regex", "sta\\ttXt", "escape", [[3, 5]]],
    ["escaped backslash inside a bracket", "s/[\\\\n]/x/", "escape", [[3, 5]]],
    [
      "escaped backslash inside a bracket hides the next escape",
      "s/[\\\\n]/x/",
      "character_escape",
      [],
    ],
    [
      "escape letter delimiter is not a regex control character",
      "sta\\ttXt",
      "character_escape",
      [],
    ],
    [
      "digit delimiter is not a replacement reference",
      "s1a1b\\11",
      "replacement_reference",
      [],
    ],
    [
      "escaped c delimiter before an ordinary character",
      "sca\\cAcYc",
      "escape",
      [[3, 5]],
    ],
    [
      "case conversion letter delimiter is an escape",
      "sUaU\\UU",
      "case_conversion",
      [],
    ],
    [
      "raw closing bracket remains after decoded closer",
      "s/[a-\\x5d]/x/",
      "regex_character",
      [[9, 10]],
    ],
    ["decoded trailing hyphen is literal", "s/[a-\\x5d]/x/", "range", []],
    [
      "control escape does not open raw bracket",
      "s[\\c[[x[",
      "character_escape",
      [[2, 5]],
    ],
    [
      "digitless numeric escape in a class name",
      "s/[[:\\digit:]]/x/",
      "escape",
      [[5, 7]],
    ],
    [
      "digitless numeric escape in a collating element",
      "s/[[.a\\ob.]]/x/",
      "escape",
      [[6, 8]],
    ],
    ["label retains carriage return", ":x\rfoo p", "label_text", [[1, 6]]],
    [
      "raw text leadin backslash does not continue the line",
      "a\\\\\np",
      "command_name",
      [
        [0, 1],
        [4, 5],
      ],
    ],
    [
      "text control escape takes its paired backslash",
      "a x\\c\\\\\np",
      "character_escape",
      [[3, 7]],
    ],
    [
      "backslash after the raw text leadin continues the line",
      "a\\\\\\\np",
      "line_continuation",
      [[3, 5]],
    ],
    ["label ends before comment", ":x#hi", "comment_text", [[2, 5]]],
    [
      "version is not restricted to digits",
      "v0alpha p",
      "version_text",
      [[1, 7]],
    ],
  ]) {
    test(`${scope}: source ranges ${name}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(result.nodes), [], result.stdout);
      assert.deepEqual(
        result.nodes
          .filter((node) => node.kind === kind)
          .map((node) => [node.startByte, node.endByte]),
        expected,
        result.stdout,
      );
    });
  }

  for (const [prefix, suffix, owner] of [
    ["s/a/", "/", "replacement"],
    ["y/", "/x/", "translation_string"],
    ["a ", "\n", "text"],
    ["r ", "\n", "filename"],
    ["b ", "\n", "label"],
    ["v ", "\n", "version"],
    ["e ", "\n", "shell_command"],
    ["s/[[:", ":]]/x/", "class_name"],
    ["s/[[.", ".]]/x/", "collating_element"],
    ["#", "\n", "comment"],
    ["s/", "/x/", "regex_branch"],
  ]) {
    test(`${scope}: invalid UTF-8 remains inside ${owner}`, () => {
      const source = Buffer.concat([
        Buffer.from(`${prefix}a`),
        Buffer.from([255, 254]),
        Buffer.from(`b${suffix}`),
      ]);
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(
          ({ outcome, reason }) => `${outcome}/${reason}`,
        ),
        ["invalid_syntax/invalid_encoding"],
        result.stdout,
      );
      const issue = result.nodes.find((node) => node.kind === "syntax_issue");
      assert.equal(result.nodes[issue.parent].kind, owner, result.stdout);
      assert.deepEqual(
        [issue.startByte, issue.endByte],
        [prefix.length + 1, prefix.length + 3],
      );
    });
  }

  for (const [prefix, suffix, kind] of [
    ["s/[", "^]/x/", "bracket_close"],
    ["s/", "*/x/", "repetition"],
  ]) {
    test(`${scope}: invalid UTF-8 occupies the regex element before ${JSON.stringify(suffix)}`, () => {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from([255]),
        Buffer.from(suffix),
      ]);
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        ["invalid_encoding"],
        result.stdout,
      );
      assert.ok(
        result.nodes.some((node) => node.kind === kind),
        result.stdout,
      );
    });
  }

  for (const prefix of ["s/\\x5c", "s/\\x5c\\\\", "s/a\\"]) {
    test(`${scope}: backslash pairing before invalid UTF-8 keeps the decode failure after ${JSON.stringify(prefix)}`, () => {
      const result = parseSuccessfully(
        scope,
        Buffer.concat([
          Buffer.from(prefix),
          Buffer.from([255]),
          Buffer.from("/x/"),
        ]),
      );
      assert.deepEqual(issueSignatures(result.nodes), [
        {
          outcome: "invalid_syntax",
          reason: "invalid_encoding",
          range: `[0, ${prefix.length}] - [0, ${prefix.length + 1}]`,
        },
      ]);
      assert.equal(
        result.nodes.some(
          ({ kind, endByte }) =>
            (kind === "escape" || kind === "character_escape") &&
            endByte > prefix.length,
        ),
        false,
        result.stdout,
      );
    });
  }

  test(`${scope}: bracket backslash before invalid UTF-8 is literal`, () => {
    const result = parseSuccessfully(
      scope,
      Buffer.concat([
        Buffer.from("s/[\\"),
        Buffer.from([255]),
        Buffer.from("]/x/"),
      ]),
    );
    assert.deepEqual(
      issueSignatures(result.nodes).map(({ reason }) => reason),
      ["invalid_encoding"],
      result.stdout,
    );
    assert.equal(
      result.nodes.filter((node) => node.kind === "escape").length,
      0,
      result.stdout,
    );
  });

  for (const [source, commands, labels, versions] of [
    [":x p", [":", "p"], ["x"], []],
    [":x\tp", [":", "p"], ["x"], []],
    ["b x p", ["b", "p"], ["x"], []],
    ["t x#hi", ["t"], ["x"], []],
    ["T x;v0alpha p", ["T", "v", "p"], ["x"], ["0alpha"]],
    ["v4.10p", ["v"], [], ["4.10p"]],
    ["vfoo", ["v"], [], ["foo"]],
    ["v4.10-rc1\tp", ["v", "p"], [], ["4.10-rc1"]],
    ["v#comment", ["v"], [], []],
  ]) {
    test(`${scope}: word operand boundaries ${JSON.stringify(source)}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(result.nodes), [], result.stdout);
      for (const [kind, expected] of [
        ["command_name", commands],
        ["label_text", labels],
        ["version_text", versions],
      ]) {
        assert.deepEqual(
          result.nodes
            .filter((node) => node.kind === kind)
            .map((node) => source.slice(node.startByte, node.endByte)),
          expected,
          result.stdout,
        );
      }
    });
  }

  for (const [source, expectedRange, spelling] of [
    ["s/[:alpha:]/x/", [3, 10], ":alpha:"],
    ["s/[^:alpha:]/x/", [4, 11], ":alpha:"],
    ["s/[\\x3a\\x61lpha\\x3a]/x/", [3, 19], "\\x3a\\x61lpha\\x3a"],
  ]) {
    test(`${scope}: misplaced class retains structure ${JSON.stringify(source)}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        ["misplaced_character_class"],
      );
      const issue = result.nodes.find((node) => node.kind === "syntax_issue");
      assert.equal(result.nodes[issue.parent].kind, "bracket_expression");
      assert.deepEqual([issue.startByte, issue.endByte], expectedRange);
      assert.equal(source.slice(issue.startByte, issue.endByte), spelling);
      assert.equal(
        result.nodes.filter((node) => node.kind === "class_name").length,
        1,
      );
      assert.equal(
        result.nodes.filter((node) => node.kind === "bracket_close").length,
        1,
      );
    });
  }

  for (const { source, expected, negation } of [
    { source: "{p;!}", expected: [], negation: true },
    { source: "{p;1}", expected: ["excess_address"], negation: false },
    { source: "{p;1!}", expected: ["excess_address"], negation: true },
    { source: "{p;1,2!}", expected: ["excess_address"], negation: true },
    { source: "{p;!!}", expected: ["duplicate_negation"], negation: true },
  ]) {
    test(`${scope}: closing brace owns its address and negation ${source}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ reason }) => reason),
        expected,
      );
      const block = nodes.findIndex(({ kind }) => kind === "block");
      const children = nodes.filter(({ parent }) => parent === block);
      assert.equal(
        children.some(({ kind }) => kind === "negation"),
        negation,
      );
      if (source.includes("1")) {
        const issue = children.find(({ kind }) => kind === "syntax_issue");
        assert.equal(issue?.startByte, 3);
        assert.equal(issue?.endByte, source.includes(",") ? 6 : 4);
      }
      assert.equal(nodes.filter(({ kind }) => kind === "command").length, 2);
    });
  }

  for (const { source, expected } of [
    { source: "1, p", expected: [["missing_address", 2, 2]] },
    {
      source: "1,2,  p",
      expected: [
        ["excess_address", 3, 4],
        ["missing_address", 4, 4],
      ],
    },
    {
      source: "1, \t",
      expected: [
        ["missing_address", 2, 2],
        ["missing_command", 2, 2],
      ],
    },
    { source: ":  #comment", expected: [["missing_operand", 1, 1]] },
    { source: "1 \t;", expected: [["missing_command", 1, 1]] },
    { source: "{p \t", expected: [["missing_closing_delimiter", 2, 2]] },
  ]) {
    test(`${scope}: missing syntax excludes following layout ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ reason, range }) => [reason, range]),
        expected.map(([reason, start, end]) => [
          reason,
          `[0, ${start}] - [0, ${end}]`,
        ]),
      );
    });
  }

  for (const { source, expected } of [
    { source: ":\0", expected: ["empty_label"] },
    { source: ": \0x p", expected: ["empty_label"] },
    { source: ":x\0y p", expected: [] },
    { source: "b\0x", expected: [] },
    { source: "t\0x", expected: [] },
    { source: "T\0x", expected: [] },
  ]) {
    test(`${scope}: NUL in label ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ reason }) => reason),
        expected,
      );
      if (expected.length) {
        const issue = nodes.find(({ kind }) => kind === "syntax_issue");
        assert.equal(issue?.startByte, source.indexOf("\0"));
        assert.equal(issue?.endByte, source.indexOf("\0") + 1);
        assert.equal(nodes[issue.parent].kind, "label");
      }
      const label = nodes.find(({ kind }) => kind === "label");
      assert.equal(
        source.slice(label.startByte, label.endByte),
        source
          .slice(source.includes(" ") && source[1] === " " ? 2 : 1)
          .split(" ")[0],
      );
    });
  }

  test(`${scope}: generated backslash pairs with preserved source backslashes`, () => {
    const source = String.raw`s/\x5c\\x5e/x/`;
    const { nodes } = parseSuccessfully(scope, source);
    assert.deepEqual(issueSignatures(nodes), []);
    const characters = nodes.filter(({ kind }) => kind === "regex_character");
    assert.deepEqual(
      characters.map(({ startByte, endByte }) =>
        source.slice(startByte, endByte),
      ),
      ["\\x5c\\", "\\x", "5", "e"],
    );
    assert.equal(
      nodes.some(({ kind }) => kind === "anchor"),
      false,
    );
    const brace = parseSuccessfully(scope, String.raw`s/a\x5c\{/x/`);
    assert.deepEqual(
      issueSignatures(brace.nodes).map(({ reason }) => reason),
      scope === "source.gsed"
        ? []
        : ["missing_interval_count", "missing_closing_delimiter"],
    );
  });

  for (const source of [String.raw`ax\c\.`, "a x\\c\\\np", "a\\\nx\\c\\."]) {
    test(`${scope}: text control escape rejects an unpaired backslash ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ outcome, reason }) => [outcome, reason]),
        [["invalid_syntax", "invalid_control_escape"]],
      );
      const issue = nodes.find(({ kind }) => kind === "syntax_issue");
      assert.equal(nodes[issue.parent].kind, "text");
      assert.equal(
        nodes.filter(({ kind }) => kind === "command_name").length,
        1,
      );
    });
  }

  for (const source of [
    String.raw`ax\c\\.`,
    "ax\\c\\",
    "a\\\nx\\c\\\\",
    "a \\c\\.",
  ]) {
    test(`${scope}: text control escape respects host processing ${JSON.stringify(source)}`, () => {
      assert.deepEqual(
        issueSignatures(parseSuccessfully(scope, source).nodes),
        [],
      );
    });
  }

  for (const source of ["s\0", "y\0", "\\\0p"]) {
    test(`${scope}: NUL is an invalid delimiter ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), [
        {
          outcome: "invalid_syntax",
          reason: "invalid_delimiter",
          range: "[0, 1] - [0, 2]",
        },
      ]);
    });
  }

  for (const source of ["r \0tail", "R\0", "w \0", "W\0", "s/a/b/w \0tail"]) {
    test(`${scope}: leading NUL empties the filename ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      const start = source.indexOf("\0");
      assert.deepEqual(issueSignatures(nodes), [
        {
          outcome: "invalid_syntax",
          reason: "empty_filename",
          range: `[0, ${start}] - [0, ${start + 1}]`,
        },
      ]);
      const issue = nodes.find(({ kind }) => kind === "syntax_issue");
      assert.equal(nodes[issue.parent].kind, "filename");
      assert.equal(
        nodes.find(({ kind }) => kind === "filename").endByte,
        source.length,
      );
      assert.equal(
        nodes
          .filter(({ kind }) => kind === "filename_text")
          .map(({ startByte, endByte }) => source.slice(startByte, endByte))
          .join(""),
        source.slice(start),
      );
    });
  }

  test(`${scope}: NUL inside a nonempty filename remains filename text`, () => {
    assert.deepEqual(
      issueSignatures(parseSuccessfully(scope, "r x\0tail").nodes),
      [],
    );
  });

  for (const source of ["!!p", "{p;!!}"]) {
    test(`${scope}: duplicate negation belongs to negation ${source}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ reason }) => reason),
        ["duplicate_negation"],
      );
      const issue = nodes.find(({ kind }) => kind === "syntax_issue");
      assert.equal(nodes[issue.parent].kind, "negation");
      assert.equal(source.slice(issue.startByte, issue.endByte), "!");
    });
  }

  for (const [contents, expected] of [
    [String.raw`1\n`, [["character_escape", String.raw`\n`]]],
    [String.raw`1\q`, [["escape", String.raw`\q`]]],
    [String.raw`1\x61`, [["character_escape", String.raw`\x61`]]],
    [
      String.raw`1x\n`,
      [
        ["literal", "x"],
        ["character_escape", String.raw`\n`],
      ],
    ],
  ]) {
    const source = scope.endsWith("ere")
      ? `s/a{${contents}}/x/`
      : `s/a\\{${contents}\\}/x/`;
    test(`${scope}: invalid interval retains source classifications ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      const reasons = nodes.filter(
        ({ kind }) => kind === "invalid_interval_character",
      );
      assert.equal(issueSignatures(nodes).length, 1);
      assert.deepEqual(
        reasons.flatMap((reason) => {
          assert.equal(
            nodes[nodes[nodes[reason.parent].parent].parent].kind,
            "interval",
          );
          return nodes
            .filter(({ parent }) => parent === nodes.indexOf(reason))
            .map(({ kind, startByte, endByte }) => [
              kind,
              source.slice(startByte, endByte),
            ]);
        }),
        expected,
      );
    });
  }

  for (const [source, expected] of [
    ["0~0r x", []],
    ["0~r x", []],
    ["00 ~ 00r x", []],
    ["0~,/a/p", []],
    ["0~0,/a/p", []],
    ["0~0,/a/!p", []],
    ["0~0p", ["invalid_zero_address"]],
    ["0~0!r x", ["invalid_zero_address"]],
    ["0~0,1p", ["invalid_zero_address"]],
    ["1,0~0p", ["invalid_zero_address"]],
  ]) {
    test(`${scope}: zero step address follows zero address restrictions ${source}`, () => {
      assert.deepEqual(
        issueSignatures(parseSuccessfully(scope, source).nodes).map(
          ({ reason }) => reason,
        ),
        expected,
      );
    });
  }

  test(`${scope}: zero step remains explicit and omitted step is not synthesized`, () => {
    const result = parseSuccessfully(scope, "0~0r x").nodes;
    assert.deepEqual(
      result
        .filter(({ kind }) => kind === "number")
        .map(({ field, startByte, endByte }) => [field, startByte, endByte]),
      [
        ["first", 0, 1],
        ["step", 2, 3],
      ],
    );
    assert.equal(
      parseSuccessfully(scope, "0~r x").nodes.some(
        ({ field }) => field === "step",
      ),
      false,
    );
  });

  for (const { source, expected, counts } of [
    { source: "+p", expected: [], counts: [] },
    { source: "~p", expected: [], counts: [] },
    { source: "+b", expected: [], counts: [] },
    { source: "+ 00p", expected: [], counts: ["00"] },
    { source: "~0p", expected: [], counts: ["0"] },
    { source: "+3p", expected: ["invalid_relative_address"], counts: ["3"] },
    { source: "~12p", expected: ["invalid_relative_address"], counts: ["12"] },
    { source: "1,+p", expected: [], counts: [] },
    { source: "1,~p", expected: [], counts: [] },
    { source: "1,+0p", expected: [], counts: ["0"] },
    { source: "1,~3p", expected: [], counts: ["3"] },
    { source: "+,2p", expected: [], counts: [] },
    { source: "+:label", expected: ["excess_address"], counts: [] },
    { source: "{+}", expected: ["excess_address"], counts: [] },
    { source: "+", expected: ["missing_command"], counts: [] },
    { source: "1~p", expected: [], counts: [] },
    { source: "1~0p", expected: [], counts: [] },
    { source: "0~p", expected: ["invalid_zero_address"], counts: [] },
  ]) {
    test(`${scope}: GNU address extension ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(nodes).map(({ reason }) => reason),
        expected,
      );
      assert.deepEqual(
        nodes
          .filter(({ field }) => field === "count")
          .map(({ startByte, endByte }) => source.slice(startByte, endByte)),
        counts,
      );
      for (const node of nodes.filter(
        ({ kind }) => kind === "invalid_relative_address",
      )) {
        assert.equal(source.slice(node.startByte, node.endByte), counts[0]);
        assert.equal(
          nodes[nodes[nodes[node.parent].parent].parent].kind,
          "relative_address",
        );
      }
    });
  }

  for (const { source, start, end = start + 3, owner } of [
    { source: String.raw`s/\c\./x/`, start: 2, owner: "regex_branch" },
    { source: String.raw`/\c\./p`, start: 1, owner: "regex_branch" },
    { source: String.raw`s/[\c\.]/x/`, start: 3, owner: "bracket_expression" },
    { source: String.raw`s/a/\c\./`, start: 4, owner: "replacement" },
    { source: String.raw`y/\c\./ab/`, start: 2, owner: "translation_string" },
    { source: String.raw`y/ab/\c\./`, start: 5, owner: "translation_string" },
    { source: String.raw`s&a&\c\&&`, start: 4, end: 8, owner: "replacement" },
    {
      source: String.raw`y&a&\c\&&`,
      start: 4,
      end: 8,
      owner: "translation_string",
    },
    { source: String.raw`sc[\c\.]cxc`, start: 3, owner: "bracket_expression" },
    { source: String.raw`s/[[:a\c\.:]]/x/`, start: 6, owner: "class_name" },
    {
      source: String.raw`s/a{\c\}/x/`,
      start: 4,
      owner: scope.endsWith("ere") ? "interval" : "regex_branch",
    },
  ]) {
    test(`${scope}: unpaired control backslash ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), [
        {
          outcome: "invalid_syntax",
          reason: "invalid_control_escape",
          range: `[0, ${start}] - [0, ${end}]`,
        },
      ]);
      const issue = nodes.find(({ kind }) => kind === "syntax_issue");
      assert.equal(nodes[issue.parent].kind, owner);
      assert.equal(
        nodes
          .filter(({ kind }) => kind === "character_escape")
          .some(
            ({ startByte, endByte }) => startByte === start && endByte === end,
          ),
        true,
      );
    });
  }

  for (const source of [
    String.raw`s/\c\\./x/`,
    String.raw`s/[\c\\]/x/`,
    String.raw`s/a/\c\\/`,
    String.raw`y/\c\\/a/`,
    String.raw`y/a/\c\\/`,
    String.raw`sc\c\.cxc`,
    String.raw`sc\cccxc`,
    String.raw`\c\c\.cp`,
    String.raw`a \c\.`,
    String.raw`s/\x5cc\./x/`,
    String.raw`s/\c\\\c\\/x/`,
    "s/a/\\c\\\ny/",
    "y/ab/x\\c\\\n/",
    String.raw`sx\c\\\\x5dxYx`,
    "s/\\c\\\\\\\\\n/x/",
    "s/\\x5b\\\n]/x/",
    "sca\\c\\\\\ncxc",
    String.raw`s/\c\\\c\//x/`,
    "s/\\c\\\\\\c\\\n/x/",
  ]) {
    test(`${scope}: control escape host processing ${JSON.stringify(source)}`, () => {
      assert.deepEqual(
        issueSignatures(parseSuccessfully(scope, source).nodes),
        [],
      );
    });
  }

  for (const [source, expected] of [
    [
      String.raw`sx\c\\\\x5dxYx`,
      [
        ["character_escape", String.raw`\c\\`],
        ["character_escape", String.raw`\\x5d`],
      ],
    ],
    [
      String.raw`st\c\\\\ttYt`,
      [
        ["character_escape", String.raw`\c\\`],
        ["character_escape", String.raw`\\t`],
      ],
    ],
    [
      "s/\\c\\\\\\\\\n/x/",
      [
        ["character_escape", String.raw`\c\\`],
        ["escape", "\\\\\n"],
      ],
    ],
    [
      "s/\\x5b\\\n]/x/",
      [
        ["character_escape", String.raw`\x5b`],
        ["escape", "\\\n"],
      ],
    ],
    [
      "sca\\c\\\\\ncxc",
      [
        ["escape", String.raw`\c`],
        ["escape", "\\\\\n"],
      ],
    ],
    [
      String.raw`s/\c\\\c\//x/`,
      [
        ["character_escape", String.raw`\c\\`],
        ["character_escape", String.raw`\c\/`],
      ],
    ],
  ]) {
    test(`${scope}: escapes read delimiter-processed characters ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      const regex = nodes.find(({ kind }) => kind === "regular_expression");
      assert.deepEqual(
        nodes
          .filter(
            ({ kind, startByte, endByte }) =>
              (kind === "escape" || kind === "character_escape") &&
              regex.startByte <= startByte &&
              endByte <= regex.endByte,
          )
          .map(({ kind, startByte, endByte }) => [
            kind,
            source.slice(startByte, endByte),
          ]),
        expected,
      );
    });
  }

  for (const [source, expected] of [
    [
      "s/\\c\\\\\n/x/",
      [
        {
          outcome: "invalid_syntax",
          reason: "invalid_control_escape",
          range: "[0, 2] - [1, 0]",
        },
      ],
    ],
    [
      String.raw`sx\c\\\\x5bxYx`,
      [
        {
          outcome: "invalid_syntax",
          reason: "missing_bracket_element",
          range: "[0, 11] - [0, 11]",
        },
        {
          outcome: "invalid_syntax",
          reason: "missing_closing_delimiter",
          range: "[0, 11] - [0, 11]",
        },
      ],
    ],
    [
      String.raw`st\x5b\c\\\tQt`,
      [
        {
          outcome: "invalid_syntax",
          reason: "missing_closing_delimiter",
          range: "[0, 11] - [0, 11]",
        },
      ],
    ],
  ]) {
    test(`${scope}: host escapes after a paired control backslash ${JSON.stringify(source)}`, () => {
      assert.deepEqual(
        issueSignatures(parseSuccessfully(scope, source).nodes),
        expected,
      );
    });
  }

  test(`${scope}: paired control escape leaves a wildcard and escaped c delimiter preserves its source`, () => {
    const source = String.raw`s/\c\\./x/`;
    const result = parseSuccessfully(scope, source);
    const wildcard = result.nodes.find(({ kind }) => kind === "wildcard");
    assert.deepEqual([wildcard.startByte, wildcard.endByte], [6, 7]);
    const escaped = parseSuccessfully(scope, String.raw`sc\c\.cxc`).nodes;
    assert.deepEqual(
      escaped
        .filter(({ kind }) => kind === "escape")
        .map(({ startByte, endByte }) => [startByte, endByte]),
      [
        [2, 4],
        [4, 6],
      ],
    );
    assert.equal(
      escaped.some(({ kind }) => kind === "character_escape"),
      false,
    );
  });
}

for (const [
  scope,
  opening,
  closing,
  alternate,
  intervalOpen,
  intervalClose,
] of [
  ["source.gsed", "\\(", "\\)", "\\|", "\\{", "\\}"],
  ["source.gsed.ere", "(", ")", "|", "{", "}"],
]) {
  for (const [name, pattern] of [
    ["empty group", `${opening}${closing}`],
    ["empty alternatives", `${alternate}a${alternate}${alternate}`],
    ["group repetition", `${opening}ab${closing}**`],
    ["interval with omitted minimum", `a${intervalOpen},2${intervalClose}`],
    ["interval with no counts", `a${intervalOpen},${intervalClose}`],
    ["backreference", `${opening}a${closing}\\1`],
    ["GNU regex escapes", "\\w\\W\\s\\S\\b\\B\\<\\>"],
    ["collating and equivalence", "[[.a.][=b=]]"],
    ["literal bracket edges", "[]^-]"],
    ["unknown and digitless escapes", "\\q\\x\\o\\d"],
    ["embedded newline", "a\\\nb"],
  ]) {
    test(`${scope}: regex ${name}`, () => {
      const result = parseSuccessfully(scope, `s/${pattern}/x/\n`);
      assert.deepEqual(issueSignatures(result.nodes), [], result.stdout);
    });
  }
  for (const [name, source, expected] of [
    ["missing command at EOF", "1", ["incomplete_syntax/missing_command"]],
    [
      "missing command before newline",
      "1\n",
      ["invalid_syntax/missing_command"],
    ],
    ["missing label", ":", ["incomplete_syntax/missing_operand"]],
    ["missing filename", "r\n", ["invalid_syntax/missing_operand"]],
    [
      "missing block close",
      "{p",
      ["incomplete_syntax/missing_closing_delimiter"],
    ],
    [
      "missing regex and replacement terminators",
      "s/a",
      [
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/unterminated_operand",
      ],
    ],
    [
      "missing group closer",
      `/${opening}a/p`,
      ["invalid_syntax/missing_closing_delimiter"],
    ],
    [
      "missing bracket closer",
      "/[a",
      [
        "incomplete_syntax/missing_closing_delimiter",
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "missing escape character",
      "/a\\",
      [
        "incomplete_syntax/missing_escape_character",
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "bracket backslash at EOF is literal",
      "/[\\",
      [
        "incomplete_syntax/missing_closing_delimiter",
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "bracket control escape at EOF",
      "/[\\c",
      [
        "incomplete_syntax/missing_escape_character",
        "incomplete_syntax/missing_closing_delimiter",
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "raw bracket control escape before newline",
      "s/[\\c\n",
      [
        "invalid_syntax/missing_escape_character",
        "invalid_syntax/missing_closing_delimiter",
        "invalid_syntax/unterminated_regex",
        "invalid_syntax/unterminated_operand",
      ],
    ],
    [
      "interval escape at EOF",
      `/a${intervalOpen}\\`,
      [
        "incomplete_syntax/missing_escape_character",
        "incomplete_syntax/missing_closing_delimiter",
        "incomplete_syntax/unterminated_regex",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "interval encoded backslash before delimiter",
      `s/a${intervalOpen}\\x5c/x/`,
      [
        "invalid_syntax/missing_escape_character",
        "invalid_syntax/missing_closing_delimiter",
      ],
    ],
    [
      "zero step digits at EOF",
      "0~0",
      [
        "incomplete_syntax/invalid_zero_address",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "zero step before blank",
      "0~0 ",
      [
        "incomplete_syntax/invalid_zero_address",
        "incomplete_syntax/missing_command",
      ],
    ],
    [
      "zero occurrence at EOF",
      "s/a/b/0",
      ["incomplete_syntax/zero_occurrence"],
    ],
    [
      "zero occurrence before blank",
      "s/a/b/0 ",
      ["invalid_syntax/zero_occurrence"],
    ],
  ]) {
    test(`${scope}: ${name}`, () => {
      const result = parseSuccessfully(scope, source);
      assert.deepEqual(
        issueSignatures(result.nodes).map(
          ({ outcome, reason }) => `${outcome}/${reason}`,
        ),
        expected,
        result.stdout,
      );
    });
  }
}

for (const [scope, open, close, alternations] of [
  ["source.gsed", "\\{", "\\}", 0],
  ["source.gsed.ere", "{", "}", 1],
]) {
  for (const [inside, expected] of [
    ["", ["missing_interval_count"]],
    ["b2", ["invalid_interval_character"]],
    ["2,x", ["invalid_interval_character"]],
    ["\\2", ["invalid_interval_character"]],
    ["1\\,2", ["invalid_interval_character"]],
    [",2", []],
  ]) {
    test(`${scope}: interval contents ${JSON.stringify(inside)}`, () => {
      const result = parseSuccessfully(scope, `s/a${open}${inside}${close}/b/`);
      assert.deepEqual(
        issueSignatures(result.nodes).map(({ reason }) => reason),
        expected,
        result.stdout,
      );
    });
  }
  test(`${scope}: invalid UTF-8 is interval content`, () => {
    const result = parseSuccessfully(
      scope,
      Buffer.concat([
        Buffer.from(`s/a${open}`),
        Buffer.from([255]),
        Buffer.from(`${close}/b/`),
      ]),
    );
    assert.deepEqual(
      issueSignatures(result.nodes).map(({ reason }) => reason),
      ["invalid_encoding"],
      result.stdout,
    );
  });
  test(`${scope}: delimiter escaping precedes regex syntax`, () => {
    const result = parseSuccessfully(scope, "s|a\\|b|x|");
    assert.deepEqual(issueSignatures(result.nodes), []);
    assert.equal(
      result.nodes.filter((node) => node.kind === "escape").length,
      1,
    );
    assert.equal(
      result.nodes.filter((node) => node.kind === "regex_branch").length,
      Number(alternations) + 1,
      result.stdout,
    );
  });
}

for (const [source, expected] of [
  [String.raw`s/a\b\{/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/a\B\{x\}/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/a\<\{\}/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/a\>\{1,2,3\}/x/`, ["invalid_interval_syntax"]],
  ["s/a\\`\\{/x/", ["invalid_interval_syntax"]],
  [String.raw`s/a\'\{/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/a\b\B\{/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/\(a\)\b\{/x/`, ["invalid_interval_syntax"]],
  [String.raw`s/\b\{/x/`, []],
  [String.raw`s/a\|\b\{/x/`, []],
  [String.raw`s/\(\b\{\)/x/`, []],
  [String.raw`s/a\b\{1\}/x/`, []],
  [String.raw`s/a\b\{,\}/x/`, []],
  [String.raw`s/a\b\{\x31\}/x/`, []],
]) {
  test(`source.gsed: interval syntax after word boundaries ${JSON.stringify(source)}`, () => {
    const { nodes } = parseSuccessfully("source.gsed", source);
    assert.deepEqual(
      issueSignatures(nodes).map(({ reason }) => reason),
      expected,
    );
    assert.equal(
      nodes.some(({ kind }) => kind === "interval" || kind === "repetition"),
      false,
    );
    for (const reason of nodes.filter(
      ({ kind }) => kind === "invalid_interval_syntax",
    )) {
      assert.equal(
        source.slice(reason.startByte, reason.endByte),
        String.raw`\{`,
      );
      assert.equal(
        nodes[nodes[nodes[reason.parent].parent].parent].kind,
        "regex_character",
      );
    }
  });
}

for (const scope of ["source.gsed", "source.gsed.ere"]) {
  const open = scope.endsWith("ere") ? "(" : "\\(";
  const close = scope.endsWith("ere") ? ")" : "\\)";
  for (const [name, source] of [
    ["100000 commands", "p;".repeat(100000)],
    ["one MiB text operand", `a ${"x".repeat(1024 * 1024)}`],
    ["100000 regex characters", `s/${"a".repeat(100000)}/b/`],
    ["2000 nested blocks", `${"{".repeat(2000)}p${"}".repeat(2000)}`],
    ["2000 nested groups", `s/${open.repeat(2000)}a${close.repeat(2000)}/b/`],
    ["2000 unclosed groups", `s/${open.repeat(2000)}a`],
  ]) {
    test(`${scope}: resources ${name}`, () => {
      const result = parseSummary(scope, source, 10_000_000);
      assert.equal(result.successful, true, JSON.stringify(result));
      console.log(
        `${scope}: ${name}: ${result.bytes} bytes, ${result.duration.secs * 1000 + result.duration.nanos / 1e6} ms`,
      );
    });
  }
}

for (const scope of ["source.gsed", "source.gsed.ere"]) {
  for (const [name, source, delimiters] of [
    ["substitution", String.raw`s\b\X\p`, ["\\", "\\", "\\"]],
    ["translation", String.raw`y\abc\xyz\;p`, ["\\", "\\", "\\"]],
    ["address", String.raw`\\b\p`, ["\\\\", "\\"]],
    ["bracket escape", String.raw`s\[\t]\X\p`, ["\\", "\\", "\\"]],
  ]) {
    test(`${scope}: backslash delimiter in ${name}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), []);
      assert.deepEqual(
        nodes
          .filter(({ kind }) => kind === "delimiter")
          .map(({ startByte, endByte }) => source.slice(startByte, endByte)),
        delimiters,
      );
    });
  }

  for (const prefix of ["a ", "e "]) {
    const literal = prefix === "a " ? "literal" : "shell_text";
    for (const [name, body, expected] of [
      [
        "odd terminal backslash",
        "x\\t\\",
        [
          [literal, "x\\t"],
          ["escape", "\\"],
        ],
      ],
      [
        "raw control escape",
        "x\\c\\.\\",
        [
          [literal, "x\\c\\."],
          ["escape", "\\"],
        ],
      ],
      [
        "three terminal backslashes",
        "x\\t\\\\\\",
        [
          [literal, "x\\t\\\\"],
          ["escape", "\\"],
        ],
      ],
      [
        "even terminal backslashes",
        "x\\t\\\\",
        [
          [literal, "x"],
          ["character_escape", "\\t"],
          ["escape", "\\\\"],
        ],
      ],
      [
        "continued raw body",
        "x\\t\\\ny\\n\\",
        [
          [literal, "x\\t"],
          ["line_continuation", "\\\n"],
          [literal, "y\\n"],
          ["escape", "\\"],
        ],
      ],
      [
        "terminated body",
        "x\\t\n",
        [
          [literal, "x"],
          ["character_escape", "\\t"],
        ],
      ],
    ]) {
      test(`${scope}: ${prefix.trim()} ${name}`, () => {
        const source = prefix + body;
        const { nodes } = parseSuccessfully(scope, source);
        assert.deepEqual(issueSignatures(nodes), []);
        assert.deepEqual(
          nodes
            .filter(({ kind }) =>
              [
                literal,
                "escape",
                "character_escape",
                "line_continuation",
              ].includes(kind),
            )
            .map(({ kind, startByte, endByte }) => [
              kind,
              source.slice(startByte, endByte),
            ]),
          expected,
        );
      });
    }
  }

  for (const verb of ["a", "e"]) {
    const literal = verb === "a" ? "literal" : "shell_text";
    for (const [suffix, expected] of [
      [
        "\\x70",
        [
          ["text_introducer", "\\"],
          [literal, "x70"],
        ],
      ],
      [
        "\\\nx\\t",
        [
          ["text_introducer", "\\\n"],
          [literal, "x"],
          ["character_escape", "\\t"],
        ],
      ],
      [
        "\\\\t\\",
        [
          ["text_introducer", "\\"],
          [literal, "\\t"],
          ["escape", "\\"],
        ],
      ],
      [
        "\\\\\\",
        [
          ["text_introducer", "\\"],
          [literal, "\\"],
          ["escape", "\\"],
        ],
      ],
      [
        "\\\\\\\\",
        [
          ["text_introducer", "\\"],
          ["escape", "\\\\"],
          ["escape", "\\"],
        ],
      ],
    ]) {
      test(`${scope}: ${verb} introducer precedes escape processing ${JSON.stringify(suffix)}`, () => {
        const source = verb + suffix;
        const { nodes } = parseSuccessfully(scope, source);
        assert.deepEqual(issueSignatures(nodes), []);
        assert.deepEqual(
          nodes
            .filter(({ kind }) =>
              [
                "text_introducer",
                literal,
                "escape",
                "character_escape",
              ].includes(kind),
            )
            .map(({ kind, startByte, endByte }) => [
              kind,
              source.slice(startByte, endByte),
            ]),
          expected,
        );
      });
    }
  }

  test(`${scope}: execute operand owns sed escape issues`, () => {
    const source = String.raw`e x\c\y`;
    const { nodes } = parseSuccessfully(scope, source);
    assert.deepEqual(issueSignatures(nodes), [
      {
        outcome: "invalid_syntax",
        reason: "invalid_control_escape",
        range: "[0, 3] - [0, 6]",
      },
    ]);
    const issue = nodes.find(({ kind }) => kind === "syntax_issue");
    assert.equal(nodes[issue.parent].kind, "shell_command");
    assert.ok(
      nodes.some(
        ({ kind, startByte, endByte }) =>
          kind === "character_escape" &&
          source.slice(startByte, endByte) === "\\c\\",
      ),
    );
  });

  for (const [name, source, escapes, references] of [
    ["first hexadecimal digit", String.raw`s5\x\55X5p`, [String.raw`\x\5`], []],
    [
      "second hexadecimal digit",
      String.raw`s5\x6\55X5p`,
      [String.raw`\x6\5`],
      [],
    ],
    [
      "both hexadecimal digits",
      String.raw`s5\x\5\55X5p`,
      [String.raw`\x\5\5`],
      [],
    ],
    ["decimal digit", String.raw`s5\d6\55X5p`, [String.raw`\d6\5`], []],
    ["octal digit", String.raw`s5\o10\55X5p`, [String.raw`\o10\5`], []],
    ["replacement digit", String.raw`s5a5\x\55p`, [String.raw`\x\5`], []],
    ["translation digit", String.raw`y5\x\55X5`, [String.raw`\x\5`], []],
    [
      "ordinary following escape",
      String.raw`s5\x6\65X5p`,
      [String.raw`\x6`],
      [String.raw`\6`],
    ],
    ["no numeric digit", String.raw`s5\x\65X5p`, [], [String.raw`\6`]],
    [
      "encoded bracket delimiters",
      String.raw`s5\x\5ba\x\5d5X5`,
      [String.raw`\x\5b`, String.raw`\x\5d`],
      [],
    ],
  ]) {
    test(`${scope}: delimiter removal precedes ${name}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), []);
      for (const [kind, expected] of [
        ["character_escape", escapes],
        ["regex_reference", references],
      ]) {
        assert.deepEqual(
          nodes
            .filter((node) => node.kind === kind)
            .map(({ startByte, endByte }) => source.slice(startByte, endByte)),
          expected,
        );
      }
    });
  }

  for (const [source, comma] of [
    ["   ,2p", 3],
    ["p;   ,2p", 5],
    ["{   ,2p}", 4],
  ]) {
    test(`${scope}: missing first address begins at comma in ${JSON.stringify(source)}`, () => {
      const { nodes } = parseSuccessfully(scope, source);
      assert.deepEqual(issueSignatures(nodes), [
        {
          outcome: "invalid_syntax",
          reason: "missing_address",
          range: `[0, ${comma}] - [0, ${comma}]`,
        },
      ]);
      assert.equal(
        nodes.filter(({ kind }) => kind === "command").at(-1).startByte,
        comma,
      );
    });
  }
}

test("source.gsed.ere: escaped numeric closing keeps the empty interval issue at its opening", () => {
  const source = String.raw`sDa{\x7\DDXD`;
  const { nodes } = parseSuccessfully("source.gsed.ere", source);
  assert.deepEqual(issueSignatures(nodes), [
    {
      outcome: "invalid_syntax",
      reason: "missing_interval_count",
      range: "[0, 4] - [0, 4]",
    },
  ]);
  assert.ok(
    nodes.some(
      ({ kind, startByte, endByte }) =>
        kind === "character_escape" &&
        source.slice(startByte, endByte) === String.raw`\x7\D`,
    ),
  );
});

test("gsed: GNU sed runtime checks the documented supplementary cases", (t) => {
  const observations = {
    version: "/opt/homebrew/bin/gsed (GNU sed) 4.10",
    os: "macOS-27.0.1-arm64-arm-64bit-Mach-O",
    executable: "/opt/homebrew/bin/gsed",
    environment: {
      PATH: "/usr/bin:/bin",
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    },
    cases: [
      {
        name: "empty_group_bre",
        arguments: ["-n", "-e", "s/\\(\\)/x/"],
        script: "s/\\(\\)/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "empty_group_ere",
        arguments: ["-n", "-E", "-e", "s/()/x/"],
        script: "s/()/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "empty_alternative_bre",
        arguments: ["-n", "-e", "s/a\\|/x/"],
        script: "s/a\\|/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "empty_alternative_ere",
        arguments: ["-n", "-E", "-e", "s/|a||/x/"],
        script: "s/|a||/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "adjacent_stars_bre",
        arguments: ["-n", "-e", "s/a**/x/"],
        script: "s/a**/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "adjacent_quantifiers_ere",
        arguments: ["-n", "-E", "-e", "s/a+?/x/"],
        script: "s/a+?/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "bad_interval_bre",
        arguments: ["-n", "-e", "s/a\\{b\\}/x/"],
        script: "s/a\\{b\\}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "bad_interval_ere",
        arguments: ["-n", "-E", "-e", "s/a{b}/x/"],
        script: "s/a{b}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "open_interval_ere",
        arguments: ["-n", "-E", "-e", "s/a{2/x/"],
        script: "s/a{2/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: Unmatched \\{\n",
        status: 1,
      },
      {
        name: "missing_minimum_ere",
        arguments: ["-n", "-E", "-e", "s/a{,2}/x/"],
        script: "s/a{,2}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "unknown_escape",
        arguments: ["-n", "-e", "s/\\q/x/"],
        script: "s/\\q/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "no_hex_digit",
        arguments: ["-n", "-e", "s/\\x/x/"],
        script: "s/\\x/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "one_hex_digit",
        arguments: ["-n", "-e", "s/\\x6/x/"],
        script: "s/\\x6/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "control_end",
        arguments: ["-n", "-e", "s/\\c/x/"],
        script: "s/\\c/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "hex_anchor",
        arguments: ["-n", "-e", "s/\\x5e/x/"],
        script: "s/\\x5e/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "hex_bracket",
        arguments: ["-n", "-e", "s/\\x5ba\\x5d/x/"],
        script: "s/\\x5ba\\x5d/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "hex_backslash_group",
        arguments: ["-n", "-e", "s/\\x5c(a\\x5c)/x/"],
        script: "s/\\x5c(a\\x5c)/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "delimiter_in_bracket",
        arguments: ["-n", "-e", "s/[/]/x/"],
        script: "s/[/]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "escaped_delimiter_alternation",
        arguments: ["-n", "-e", "s|a\\|b|x|"],
        script: "s|a\\|b|x|",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "empty_regex_modifier",
        arguments: ["-n", "-e", "s//x/I"],
        script: "s//x/I",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: cannot specify modifiers on empty regexp\n",
        status: 1,
      },
      {
        name: "evaluate_flag_separator",
        arguments: ["-n", "-e", "s/a/b/e;p"],
        script: "s/a/b/e;p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "label_separator",
        arguments: ["-n", "-e", ": loop ; b loop"],
        script: ": loop ; b loop",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "text_single_line",
        arguments: ["-n", "-e", "a hello; p"],
        script: "a hello; p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "short_text",
        arguments: ["-n", "-e", "a"],
        script: "a",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 1: expected \\ after 'a', 'c' or 'i'\n",
        status: 1,
      },
      {
        name: "trailing_text_slash",
        arguments: ["-n", "-e", "a text\\"],
        script: "a text\\",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "zero_print",
        arguments: ["-n", "-e", "0p"],
        script: "0p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "zero_step",
        arguments: ["-n", "-e", "0~2p"],
        script: "0~2p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "zero_range",
        arguments: ["-n", "-e", "0,/a/p"],
        script: "0,/a/p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "range_zero_step",
        arguments: ["-n", "-e", "1,~0p"],
        script: "1,~0p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "unicode_delimiter",
        arguments: ["-n", "-e", "séaébég"],
        script: "séaébég",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "unmatched_group_ere",
        arguments: ["-n", "-E", "-e", "s/)/x/"],
        script: "s/)/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: Unmatched ) or \\)\n",
        status: 1,
      },
      {
        name: "start_star_bre",
        arguments: ["-n", "-e", "s/*/x/"],
        script: "s/*/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "start_star_ere",
        arguments: ["-n", "-E", "-e", "s/*/x/"],
        script: "s/*/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: Invalid preceding regular expression\n",
        status: 1,
      },
      {
        name: "interval_empty",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/a{}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "interval_comma_only",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/a{,}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "interval_extra_comma",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/a{1,,2}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "interval_reversed",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/a{3,2}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "interval_leading",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/{2}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid preceding regular expression\n",
        status: 1,
      },
      {
        name: "interval_unmatched_close",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/a}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "duplicate_global",
        arguments: ["-n", "-f", "-"],
        script: "s/a/b/gg",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: multiple 'g' options to 's' command\n",
        status: 1,
      },
      {
        name: "duplicate_print",
        arguments: ["-n", "-f", "-"],
        script: "s/a/b/pp",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: multiple 'p' options to 's' command\n",
        status: 1,
      },
      {
        name: "duplicate_occurrence",
        arguments: ["-n", "-f", "-"],
        script: "s/a/b/2 3",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: multiple number options to 's' command\n",
        status: 1,
      },
      {
        name: "zero_occurrence",
        arguments: ["-n", "-f", "-"],
        script: "s/a/b/0",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: number option to 's' command may not be zero\n",
        status: 1,
      },
      {
        name: "empty_modifier_address",
        arguments: ["-n", "-f", "-"],
        script: "//Ip",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: cannot specify modifiers on empty regexp\n",
        status: 1,
      },
      {
        name: "excess_quit_addresses",
        arguments: ["-n", "-f", "-"],
        script: "1,2q",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: command only uses one address\n",
        status: 1,
      },
      {
        name: "comment_address",
        arguments: ["-n", "-f", "-"],
        script: "1# comment",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: comments don't accept any addresses\n",
        status: 1,
      },
      {
        name: "label_address",
        arguments: ["-n", "-f", "-"],
        script: "1:loop",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: : doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "read_zero",
        arguments: ["-n", "-f", "-"],
        script: "0rmissing",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "filename_empty",
        arguments: ["-n", "-f", "-"],
        script: "r",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "label_empty",
        arguments: ["-n", "-f", "-"],
        script: ":",
        input: "",
        stdout: "",
        stderr: '/opt/homebrew/bin/gsed: file - line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "label_brace",
        arguments: ["-n", "-f", "-"],
        script: ": }",
        input: "",
        stdout: "",
        stderr: '/opt/homebrew/bin/gsed: file - line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "double_negation",
        arguments: ["-n", "-f", "-"],
        script: "!!p",
        input: "",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: file - line 1: multiple '!'s\n",
        status: 1,
      },
      {
        name: "missing_separator",
        arguments: ["-n", "-f", "-"],
        script: "pd",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: extra characters after command\n",
        status: 1,
      },
      {
        name: "extra_address",
        arguments: ["-n", "-f", "-"],
        script: "1,2,3p",
        input: "",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: file - line 1: unknown command: ','\n",
        status: 1,
      },
      {
        name: "text_backslash_no_newline",
        arguments: ["-n", "-f", "-"],
        script: "a\\hello",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "text_empty_introducer",
        arguments: ["-n", "-f", "-"],
        script: "a\\",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "text_empty_line",
        arguments: ["-n", "-f", "-"],
        script: "a\\\n",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "raw_nul_regex",
        arguments: ["-n", "-f", "-"],
        script: "s/\u0000/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "numeric_nul_regex",
        arguments: ["-n", "-f", "-"],
        script: "s/\\x00/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "invalid_class",
        arguments: ["-n", "-f", "-"],
        script: "s/[[:unknown:]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid character class name\n",
        status: 1,
      },
      {
        name: "empty_class",
        arguments: ["-n", "-f", "-"],
        script: "s/[[:]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "trailing_bracket_dash",
        arguments: ["-n", "-f", "-"],
        script: "s/[a-]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "leading_bracket_dash",
        arguments: ["-n", "-f", "-"],
        script: "s/[-a]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "bracket_backslash",
        arguments: ["-n", "-f", "-"],
        script: "s/[\\*]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "numeric_backslash",
        arguments: ["-n", "-f", "-"],
        script: "s/\\x5c(a\\x5c)/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "regex_continued_line",
        arguments: ["-n", "-f", "-"],
        script: "s/a\\\nb/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "backref_missing_group",
        arguments: ["-n", "-E", "-f", "-"],
        script: "s/\\1/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: Invalid back reference\n",
        status: 1,
      },
      {
        name: "pattern_bad_utf8_escape",
        arguments: ["-n", "-f", "-"],
        script: "s/\\xff/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "pattern_utf8_escape_pair",
        arguments: ["-n", "-f", "-"],
        script: "s/\\xce\\xa3*/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "unknown_flag",
        arguments: ["-n", "-f", "-"],
        script: "s/a/b/k",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file - line 1: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "address_modifier_lowercase",
        arguments: ["-n", "-f", "-"],
        script: "/a/id",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "s/a/b/pep",
        arguments: ["-n", "-e", "s/a/b/pep"],
        script: "s/a/b/pep",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: multiple 'p' options to 's' command\n",
        status: 1,
      },
      {
        name: "s/a/b/ee",
        arguments: ["-n", "-e", "s/a/b/ee"],
        script: "s/a/b/ee",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "s/a/b/II",
        arguments: ["-n", "-e", "s/a/b/II"],
        script: "s/a/b/II",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "s/a/b/mm",
        arguments: ["-n", "-e", "s/a/b/mm"],
        script: "s/a/b/mm",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "s/a/b/ww",
        arguments: ["-n", "-e", "s/a/b/ww"],
        script: "s/a/b/ww",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "s/a/b/00",
        arguments: ["-n", "-e", "s/a/b/00"],
        script: "s/a/b/00",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: number option to 's' command may not be zero\n",
        status: 1,
      },
      {
        name: "s/a/b/g g",
        arguments: ["-n", "-e", "s/a/b/g g"],
        script: "s/a/b/g g",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: multiple 'g' options to 's' command\n",
        status: 1,
      },
      {
        name: "s/a/b/2p3",
        arguments: ["-n", "-e", "s/a/b/2p3"],
        script: "s/a/b/2p3",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: multiple number options to 's' command\n",
        status: 1,
      },
      {
        name: "/a/IIMMp",
        arguments: ["-n", "-e", "/a/IIMMp"],
        script: "/a/IIMMp",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "//Mp",
        arguments: ["-n", "-e", "//Mp"],
        script: "//Mp",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: cannot specify modifiers on empty regexp\n",
        status: 1,
      },
      {
        name: "s//x/i",
        arguments: ["-n", "-e", "s//x/i"],
        script: "s//x/i",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: cannot specify modifiers on empty regexp\n",
        status: 1,
      },
      {
        name: "s//x/e",
        arguments: ["-n", "-e", "s//x/e"],
        script: "s//x/e",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "a\\",
        arguments: ["-n", "-e", "a\\"],
        script: "a\\",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p#x",
        arguments: ["-n", "-e", "p#x"],
        script: "p#x",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p #x",
        arguments: ["-n", "-e", "p #x"],
        script: "p #x",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p\\\np",
        arguments: ["-n", "-e", "p\\\np"],
        script: "p\\\np",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: extra characters after command\n",
        status: 1,
      },
      {
        name: "{p}p",
        arguments: ["-n", "-e", "{p}p"],
        script: "{p}p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: extra characters after command\n",
        status: 1,
      },
      {
        name: "/a/!#x",
        arguments: ["-n", "-e", "/a/!#x"],
        script: "/a/!#x",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 5: comments don't accept any addresses\n",
        status: 1,
      },
      {
        name: "s/[a\\x5db]/x/g",
        arguments: ["-e", "s/[a\\x5db]/x/g"],
        script: "s/[a\\x5db]/x/g",
        input: "a]b\nab]\n",
        stdout: "a]b\nx\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s/[a\\x2dz]/x/g",
        arguments: ["-e", "s/[a\\x2dz]/x/g"],
        script: "s/[a\\x2dz]/x/g",
        input: "a-zb\n",
        stdout: "x-xx\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s/\\xce\\xa3*/X/g",
        arguments: ["-e", "s/\\xce\\xa3*/X/g"],
        script: "s/\\xce\\xa3*/X/g",
        input: "ΣΣ\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s/[\\*]/X/g",
        arguments: ["-e", "s/[\\*]/X/g"],
        script: "s/[\\*]/X/g",
        input: "\\*\n",
        stdout: "XX\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s/\\x2a/X/g",
        arguments: ["-e", "s/\\x2a/X/g"],
        script: "s/\\x2a/X/g",
        input: "*\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s|a\\|b|X|",
        arguments: ["-e", "s|a\\|b|X|"],
        script: "s|a\\|b|X|",
        input: "a|b\na\nb\n",
        stdout: "X\na\nb\n",
        stderr: "",
        status: 0,
      },
      {
        name: "s/\\x5c(a\\x5c)/X/",
        arguments: ["-e", "s/\\x5c(a\\x5c)/X/"],
        script: "s/\\x5c(a\\x5c)/X/",
        input: "a\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_96",
        arguments: ["-n", "-E", "-e", "1,2q"],
        script: "1,2q",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: command only uses one address\n",
        status: 1,
      },
      {
        name: "address_or_interval_97",
        arguments: ["-n", "-E", "-e", "1,2Q"],
        script: "1,2Q",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: command only uses one address\n",
        status: 1,
      },
      {
        name: "address_or_interval_98",
        arguments: ["-n", "-E", "-e", "1,2l"],
        script: "1,2l",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_99",
        arguments: ["-n", "-E", "-e", "1,2="],
        script: "1,2=",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_100",
        arguments: ["-n", "-E", "-e", "1,2F"],
        script: "1,2F",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_101",
        arguments: ["-n", "-E", "-e", "1,2v"],
        script: "1,2v",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_102",
        arguments: ["-n", "-E", "-e", "1,2:label"],
        script: "1,2:label",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: : doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "address_or_interval_103",
        arguments: ["-n", "-E", "-e", "1,2a hi"],
        script: "1,2a hi",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_104",
        arguments: ["-n", "-E", "-e", "1,2i hi"],
        script: "1,2i hi",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_105",
        arguments: ["-n", "-E", "-e", "1,2r absent"],
        script: "1,2r absent",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_106",
        arguments: ["-n", "-E", "-e", "1,2R absent"],
        script: "1,2R absent",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_107",
        arguments: ["-n", "-E", "-e", "1,2#comment"],
        script: "1,2#comment",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: comments don't accept any addresses\n",
        status: 1,
      },
      {
        name: "address_or_interval_108",
        arguments: ["-n", "-E", "-e", "1,2b label\n:label"],
        script: "1,2b label\n:label",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_109",
        arguments: ["-n", "-E", "-e", "0p"],
        script: "0p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_110",
        arguments: ["-n", "-E", "-e", "00p"],
        script: "00p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_111",
        arguments: ["-n", "-E", "-e", "0~2p"],
        script: "0~2p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_112",
        arguments: ["-n", "-E", "-e", "0,/a/p"],
        script: "0,/a/p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_113",
        arguments: ["-n", "-E", "-e", "0r absent"],
        script: "0r absent",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_114",
        arguments: ["-n", "-E", "-e", "0R absent"],
        script: "0R absent",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_115",
        arguments: ["-n", "-E", "-e", "0w out"],
        script: "0w out",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_116",
        arguments: ["-n", "-E", "-e", "0!r absent"],
        script: "0!r absent",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_117",
        arguments: ["-n", "-E", "-e", "0,1p"],
        script: "0,1p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_118",
        arguments: ["-n", "-E", "-e", "1,0p"],
        script: "1,0p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_119",
        arguments: ["-n", "-E", "-e", "1,~0p"],
        script: "1,~0p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_120",
        arguments: ["-n", "-E", "-e", "0,~0p"],
        script: "0,~0p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 5: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "address_or_interval_121",
        arguments: ["-n", "-E", "-e", "1#comment"],
        script: "1#comment",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: comments don't accept any addresses\n",
        status: 1,
      },
      {
        name: "address_or_interval_122",
        arguments: ["-n", "-E", "-e", "1:label"],
        script: "1:label",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: : doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "address_or_interval_123",
        arguments: ["-n", "-E", "-e", "1v"],
        script: "1v",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_124",
        arguments: ["-n", "-E", "-e", "1,2,3p"],
        script: "1,2,3p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: unknown command: ','\n",
        status: 1,
      },
      {
        name: "address_or_interval_125",
        arguments: ["-n", "-E", "-e", ",2p"],
        script: ",2p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 1: unknown command: ','\n",
        status: 1,
      },
      {
        name: "address_or_interval_126",
        arguments: ["-n", "-E", "-e", "1,p"],
        script: "1,p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: unexpected ','\n",
        status: 1,
      },
      {
        name: "address_or_interval_127",
        arguments: ["-n", "-E", "-e", "1~p"],
        script: "1~p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_128",
        arguments: ["-n", "-E", "-e", "1s a b "],
        script: "1s a b ",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "address_or_interval_130",
        arguments: ["-n", "-E", "-e", "s/a{2,x}/x/"],
        script: "s/a{2,x}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "boundary_131",
        arguments: ["-n", "-e", "s a b "],
        script: "s a b ",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_132",
        arguments: ["-n", "-E", "-e", "s a b "],
        script: "s a b ",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_133",
        arguments: ["-n", "-e", "s /a/b/"],
        script: "s /a/b/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "boundary_134",
        arguments: ["-n", "-E", "-e", "s /a/b/"],
        script: "s /a/b/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "boundary_135",
        arguments: ["-n", "-e", "y ab cd "],
        script: "y ab cd ",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_136",
        arguments: ["-n", "-E", "-e", "y ab cd "],
        script: "y ab cd ",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_137",
        arguments: ["-n", "-e", "0~p"],
        script: "0~p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "boundary_138",
        arguments: ["-n", "-E", "-e", "0~p"],
        script: "0~p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "boundary_139",
        arguments: ["-n", "-e", "0~0p"],
        script: "0~0p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "boundary_140",
        arguments: ["-n", "-E", "-e", "0~0p"],
        script: "0~0p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "boundary_141",
        arguments: ["-n", "-e", "1~p"],
        script: "1~p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_143",
        arguments: ["-n", "-e", "1~0p"],
        script: "1~0p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_144",
        arguments: ["-n", "-E", "-e", "1~0p"],
        script: "1~0p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_145",
        arguments: ["-n", "-e", "1,+p"],
        script: "1,+p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_146",
        arguments: ["-n", "-E", "-e", "1,+p"],
        script: "1,+p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_147",
        arguments: ["-n", "-e", "1,~p"],
        script: "1,~p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_148",
        arguments: ["-n", "-E", "-e", "1,~p"],
        script: "1,~p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_149",
        arguments: ["-n", "-e", "1,2,3p"],
        script: "1,2,3p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 4: unknown command: ','\n",
        status: 1,
      },
      {
        name: "boundary_153",
        arguments: ["-n", "-e", "s/\\+/x/"],
        script: "s/\\+/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_154",
        arguments: ["-n", "-E", "-e", "s/\\+/x/"],
        script: "s/\\+/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_155",
        arguments: ["-n", "-e", "s/\\?/x/"],
        script: "s/\\?/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_156",
        arguments: ["-n", "-E", "-e", "s/\\?/x/"],
        script: "s/\\?/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_157",
        arguments: ["-n", "-e", "s/\\{2\\}/x/"],
        script: "s/\\{2\\}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_158",
        arguments: ["-n", "-E", "-e", "s/\\{2\\}/x/"],
        script: "s/\\{2\\}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_159",
        arguments: ["-n", "-e", "s/{2}/x/"],
        script: "s/{2}/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_160",
        arguments: ["-n", "-E", "-e", "s/{2}/x/"],
        script: "s/{2}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: Invalid preceding regular expression\n",
        status: 1,
      },
      {
        name: "boundary_161",
        arguments: ["-n", "-e", "s/^^a/x/"],
        script: "s/^^a/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_162",
        arguments: ["-n", "-E", "-e", "s/^^a/x/"],
        script: "s/^^a/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_163",
        arguments: ["-n", "-e", "s/a$*/x/"],
        script: "s/a$*/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_164",
        arguments: ["-n", "-E", "-e", "s/a$*/x/"],
        script: "s/a$*/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: Invalid preceding regular expression\n",
        status: 1,
      },
      {
        name: "boundary_165",
        arguments: ["-n", "-e", "s/\\b*/x/"],
        script: "s/\\b*/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_166",
        arguments: ["-n", "-E", "-e", "s/\\b*/x/"],
        script: "s/\\b*/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: Invalid preceding regular expression\n",
        status: 1,
      },
      {
        name: "quoted_delimiter_167",
        arguments: ["-n", "-e", "s*a\\**X*g;p"],
        script: "s*a\\**X*g;p",
        input: "aaa a*\n",
        stdout: "X X*X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_168",
        arguments: ["-n", "-E", "-e", "s*a\\**X*g;p"],
        script: "s*a\\**X*g;p",
        input: "aaa a*\n",
        stdout: "X X*X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_169",
        arguments: ["-n", "-e", "s.a\\..X.g;p"],
        script: "s.a\\..X.g;p",
        input: "ab a.\n",
        stdout: "X X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_170",
        arguments: ["-n", "-E", "-e", "s.a\\..X.g;p"],
        script: "s.a\\..X.g;p",
        input: "ab a.\n",
        stdout: "X X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_171",
        arguments: ["-n", "-e", "s|a\\|b|X|g;p"],
        script: "s|a\\|b|X|g;p",
        input: "a|b ab a b\n",
        stdout: "X ab a b\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_172",
        arguments: ["-n", "-E", "-e", "s|a\\|b|X|g;p"],
        script: "s|a\\|b|X|g;p",
        input: "a|b ab a b\n",
        stdout: "X|X XX X X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_173",
        arguments: ["-n", "-e", "s[a\\[b[X[g;p"],
        script: "s[a\\[b[X[g;p",
        input: "a[b ab\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "quoted_delimiter_174",
        arguments: ["-n", "-E", "-e", "s[a\\[b[X[g;p"],
        script: "s[a\\[b[X[g;p",
        input: "a[b ab\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "quoted_delimiter_175",
        arguments: ["-n", "-e", "s/[\\x5c*]/X/g;p"],
        script: "s/[\\x5c*]/X/g;p",
        input: "\\*x\n",
        stdout: "XXx\n",
        stderr: "",
        status: 0,
      },
      {
        name: "quoted_delimiter_176",
        arguments: ["-n", "-E", "-e", "s/[\\x5c*]/X/g;p"],
        script: "s/[\\x5c*]/X/g;p",
        input: "\\*x\n",
        stdout: "XXx\n",
        stderr: "",
        status: 0,
      },
      {
        name: "raw_bracket_after_numeric_closer_bre",
        arguments: ["-n", "-e", "s/[a-\\x5d]/x/"],
        script: "s/[a-\\x5d]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "raw_bracket_unclosed_bre",
        arguments: ["-n", "-e", "s/[a-\\x5d/x/"],
        script: "s/[a-\\x5d/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "encoded_bracket_before_delimiter_bre",
        arguments: ["-n", "-e", "s/\\x5b/x/"],
        script: "s/\\x5b/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Invalid regular expression\n",
        status: 1,
      },
      {
        name: "delimiter_in_raw_bracket_bre",
        arguments: ["-n", "-e", "s@[a\\x5d@]@x@"],
        script: "s@[a\\x5d@]@x@",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "overlapping_ranges_bre",
        arguments: ["-n", "-e", "s/[a-b-c]/x/"],
        script: "s/[a-b-c]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: Invalid range end\n",
        status: 1,
      },
      {
        name: "class_range_endpoint_bre",
        arguments: ["-n", "-e", "s/[[:alpha:]-z]/x/"],
        script: "s/[[:alpha:]-z]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 18: Invalid range end\n",
        status: 1,
      },
      {
        name: "equivalence_range_endpoint_bre",
        arguments: ["-n", "-e", "s/[a-[=z=]]/x/"],
        script: "s/[a-[=z=]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 14: Invalid range end\n",
        status: 1,
      },
      {
        name: "collating_range_endpoint_bre",
        arguments: ["-n", "-e", "s/[a-[.z.]]/x/"],
        script: "s/[a-[.z.]]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "orphan_group_close_bre",
        arguments: ["-n", "-e", "s/)/x/"],
        script: "s/)/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "host_escaped_dollar_bre",
        arguments: ["-n", "-e", "s$\\$$x$"],
        script: "s$\\$$x$",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "raw_bracket_after_numeric_closer_ere",
        arguments: ["-n", "-E", "-e", "s/[a-\\x5d]/x/"],
        script: "s/[a-\\x5d]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "raw_bracket_unclosed_ere",
        arguments: ["-n", "-E", "-e", "s/[a-\\x5d/x/"],
        script: "s/[a-\\x5d/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "encoded_bracket_before_delimiter_ere",
        arguments: ["-n", "-E", "-e", "s/\\x5b/x/"],
        script: "s/\\x5b/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Invalid regular expression\n",
        status: 1,
      },
      {
        name: "delimiter_in_raw_bracket_ere",
        arguments: ["-n", "-E", "-e", "s@[a\\x5d@]@x@"],
        script: "s@[a\\x5d@]@x@",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "overlapping_ranges_ere",
        arguments: ["-n", "-E", "-e", "s/[a-b-c]/x/"],
        script: "s/[a-b-c]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: Invalid range end\n",
        status: 1,
      },
      {
        name: "class_range_endpoint_ere",
        arguments: ["-n", "-E", "-e", "s/[[:alpha:]-z]/x/"],
        script: "s/[[:alpha:]-z]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 18: Invalid range end\n",
        status: 1,
      },
      {
        name: "equivalence_range_endpoint_ere",
        arguments: ["-n", "-E", "-e", "s/[a-[=z=]]/x/"],
        script: "s/[a-[=z=]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 14: Invalid range end\n",
        status: 1,
      },
      {
        name: "collating_range_endpoint_ere",
        arguments: ["-n", "-E", "-e", "s/[a-[.z.]]/x/"],
        script: "s/[a-[.z.]]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "host_escaped_dollar_ere",
        arguments: ["-n", "-E", "-e", "s$\\$$x$"],
        script: "s$\\$$x$",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "control_consumes_pattern_delimiter",
        arguments: ["-n", "-e", "s/\\c//x/"],
        script: "s/\\c//x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "trailing_control_replacement",
        arguments: ["-n", "-e", "s/a/\\c/"],
        script: "s/a/\\c/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "encoded_backslash_before_pattern_end",
        arguments: ["-n", "-e", "s/\\x5c/x/"],
        script: "s/\\x5c/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Trailing backslash\n",
        status: 1,
      },
      {
        name: "digit_delimiter_before_hex_digit",
        arguments: ["-n", "-e", "s2\\x2x2"],
        script: "s2\\x2x2",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_delimiter_in_replacement",
        arguments: ["-n", "-e", "s2a2\\x2"],
        script: "s2a2\\x2",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_omitted_branch_and_execute_operands_bre",
        arguments: ["-n", "-e", "b;t;T;e"],
        script: "b;t;T;e",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_label_space_before_command_bre",
        arguments: ["-n", "-e", ":x p"],
        script: ":x p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_branch_space_before_command_bre",
        arguments: ["-n", "-e", ":x\nt x p"],
        script: ":x\nt x p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_label_hash_starts_comment_bre",
        arguments: ["-n", "-e", ":x#comment\nb x"],
        script: ":x#comment\nb x",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_missing_label_before_comment_bre",
        arguments: ["-n", "-e", ":#comment"],
        script: ":#comment",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: -e expression #1, char 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "review_label_carriage_return_bre",
        arguments: ["-n", "-e", ":x\rfoo\nb x\rfoo"],
        script: ":x\rfoo\nb x\rfoo",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_space_before_command_bre",
        arguments: ["-n", "-e", "v4.10 p"],
        script: "v4.10 p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_suffix_word_bre",
        arguments: ["-n", "-e", "v0alpha p"],
        script: "v0alpha p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_requirement_is_not_syntax_bre",
        arguments: ["-n", "-e", "v4.10-rc1"],
        script: "v4.10-rc1",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: expected newer version of sed\n",
        status: 1,
      },
      {
        name: "review_command_layout_controls_bre",
        arguments: ["-n", "-e", "\rp;\u000bp;\fp"],
        script: "\rp;\u000bp;\fp",
        input: "input\n",
        stdout: "input\ninput\ninput\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_carriage_return_after_address_bre",
        arguments: ["-n", "-e", "1\rp"],
        script: "1\rp",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: unknown command: '\r'\n",
        status: 1,
      },
      {
        name: "review_carriage_return_substitution_flag_bre",
        arguments: ["-n", "-e", "s/a/b/\r"],
        script: "s/a/b/\r",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "review_control_bracket_delimiter_bre",
        arguments: ["-n", "-e", "s[\\c[[x["],
        script: "s[\\c[[x[",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_misplaced_class_bre",
        arguments: ["-n", "-e", "s/[:alpha:]/x/"],
        script: "s/[:alpha:]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_misplaced_negated_class_bre",
        arguments: ["-n", "-e", "s/[^:alpha:]/x/"],
        script: "s/[^:alpha:]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_misplaced_encoded_class_bre",
        arguments: ["-n", "-e", "s/[\\x3a\\x61lpha\\x3a]/x/"],
        script: "s/[\\x3a\\x61lpha\\x3a]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_empty_colon_bracket_bre",
        arguments: ["-n", "-e", "s/[::]/x/"],
        script: "s/[::]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_colon_bracket_range_bre",
        arguments: ["-n", "-e", "s/[:a-b:]/x/"],
        script: "s/[:a-b:]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_omitted_branch_and_execute_operands_ere",
        arguments: ["-n", "-E", "-e", "b;t;T;e"],
        script: "b;t;T;e",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_label_space_before_command_ere",
        arguments: ["-n", "-E", "-e", ":x p"],
        script: ":x p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_branch_space_before_command_ere",
        arguments: ["-n", "-E", "-e", ":x\nt x p"],
        script: ":x\nt x p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_label_hash_starts_comment_ere",
        arguments: ["-n", "-E", "-e", ":x#comment\nb x"],
        script: ":x#comment\nb x",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_missing_label_before_comment_ere",
        arguments: ["-n", "-E", "-e", ":#comment"],
        script: ":#comment",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: -e expression #1, char 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "review_label_carriage_return_ere",
        arguments: ["-n", "-E", "-e", ":x\rfoo\nb x\rfoo"],
        script: ":x\rfoo\nb x\rfoo",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_space_before_command_ere",
        arguments: ["-n", "-E", "-e", "v4.10 p"],
        script: "v4.10 p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_suffix_word_ere",
        arguments: ["-n", "-E", "-e", "v0alpha p"],
        script: "v0alpha p",
        input: "input\n",
        stdout: "input\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_version_requirement_is_not_syntax_ere",
        arguments: ["-n", "-E", "-e", "v4.10-rc1"],
        script: "v4.10-rc1",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: expected newer version of sed\n",
        status: 1,
      },
      {
        name: "review_command_layout_controls_ere",
        arguments: ["-n", "-E", "-e", "\rp;\u000bp;\fp"],
        script: "\rp;\u000bp;\fp",
        input: "input\n",
        stdout: "input\ninput\ninput\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_carriage_return_after_address_ere",
        arguments: ["-n", "-E", "-e", "1\rp"],
        script: "1\rp",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: unknown command: '\r'\n",
        status: 1,
      },
      {
        name: "review_carriage_return_substitution_flag_ere",
        arguments: ["-n", "-E", "-e", "s/a/b/\r"],
        script: "s/a/b/\r",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "review_control_bracket_delimiter_ere",
        arguments: ["-n", "-E", "-e", "s[\\c[[x["],
        script: "s[\\c[[x[",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_misplaced_class_ere",
        arguments: ["-n", "-E", "-e", "s/[:alpha:]/x/"],
        script: "s/[:alpha:]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_misplaced_negated_class_ere",
        arguments: ["-n", "-E", "-e", "s/[^:alpha:]/x/"],
        script: "s/[^:alpha:]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_misplaced_encoded_class_ere",
        arguments: ["-n", "-E", "-e", "s/[\\x3a\\x61lpha\\x3a]/x/"],
        script: "s/[\\x3a\\x61lpha\\x3a]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: character class syntax is [[:space:]], not [:space:]\n",
        status: 4,
      },
      {
        name: "review_empty_colon_bracket_ere",
        arguments: ["-n", "-E", "-e", "s/[::]/x/"],
        script: "s/[::]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_colon_bracket_range_ere",
        arguments: ["-n", "-E", "-e", "s/[:a-b:]/x/"],
        script: "s/[:a-b:]/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_closing_negation_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;!}",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_closing_address_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;1}",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "boundary_closing_address_negation_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;1!}",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "boundary_class_control_completion_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\c,pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_hex_completion_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\x6cpha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_octal_completion_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\o154pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_decimal_completion_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\d108pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_generated_backslash_preserved_escape_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/a\\x5c\\{/x/p",
        input: "a\\{\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_generated_backslash_preserved_pair_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/\\x5c\\\\x5e/x/p",
        input: "\\x5e\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_generated_backslash_encoded_pair_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/a\\x5c\\x5c{/x/p",
        input: "a\\{\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_leading_nul_label_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":\u0000",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: file script.sed line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "boundary_leading_nul_label_suffix_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":\u0000x",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: file script.sed line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "boundary_embedded_nul_label_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":x\u0000y p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_branch_nul_label_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "b\u0000x",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_without_count_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_tilde_without_count_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_zero_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_positive_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+3p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "boundary_recursive_control_escape_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/\\c\\./x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "boundary_recursive_control_c_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script_file: "script.sed",
        script: "sc\\c\\.cxc",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_closing_negation_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;!}",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_closing_address_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;1}",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "boundary_closing_address_negation_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "{p;1!}",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "boundary_class_control_completion_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\c,pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_hex_completion_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\x6cpha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_octal_completion_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\o154pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_class_decimal_completion_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "/[[:a\\d108pha:]]/p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_generated_backslash_preserved_escape_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/a\\x5c\\{/x/p",
        input: "a\\{\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Unmatched \\{\n",
        status: 1,
      },
      {
        name: "boundary_generated_backslash_preserved_pair_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/\\x5c\\\\x5e/x/p",
        input: "\\x5e\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_generated_backslash_encoded_pair_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/a\\x5c\\x5c{/x/p",
        input: "a\\{\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Unmatched \\{\n",
        status: 1,
      },
      {
        name: "boundary_leading_nul_label_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":\u0000",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: file script.sed line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "boundary_leading_nul_label_suffix_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":\u0000x",
        input: "",
        stdout: "",
        stderr:
          '/opt/homebrew/bin/gsed: file script.sed line 1: ":" lacks a label\n',
        status: 1,
      },
      {
        name: "boundary_embedded_nul_label_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: ":x\u0000y p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_branch_nul_label_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "b\u0000x",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_without_count_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_tilde_without_count_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_zero_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "boundary_first_relative_positive_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "+3p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "boundary_recursive_control_escape_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "s/\\c\\./x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "boundary_recursive_control_c_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script_file: "script.sed",
        script: "sc\\c\\.cxc",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_2_bre",
        arguments: ["-n", "-e", "+b"],
        script: "+b",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_4_bre",
        arguments: ["-n", "-e", "~0p"],
        script: "~0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_5_bre",
        arguments: ["-n", "-e", "+00p"],
        script: "+00p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_6_bre",
        arguments: ["-n", "-e", "+3p"],
        script: "+3p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "p15_address_extension_7_bre",
        arguments: ["-n", "-e", "~12p"],
        script: "~12p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "p15_address_extension_8_bre",
        arguments: ["-n", "-e", "+ 00p"],
        script: "+ 00p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_9_bre",
        arguments: ["-n", "-e", "1~p"],
        script: "1~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_10_bre",
        arguments: ["-n", "-e", "1~0p"],
        script: "1~0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_11_bre",
        arguments: ["-n", "-e", "1,+p"],
        script: "1,+p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_12_bre",
        arguments: ["-n", "-e", "1,~p"],
        script: "1,~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_13_bre",
        arguments: ["-n", "-e", "1,+0p"],
        script: "1,+0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_14_bre",
        arguments: ["-n", "-e", "+,2p"],
        script: "+,2p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_15_bre",
        arguments: ["-n", "-e", "+:label"],
        script: "+:label",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: : doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "p15_address_extension_16_bre",
        arguments: ["-n", "-e", "{+}"],
        script: "{+}",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "p15_control_escape_0_bre",
        arguments: ["-n", "-e", "s/\\c\\./X/p"],
        script: "s/\\c\\./X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_1_bre",
        arguments: ["-n", "-e", "s/\\c\\c/X/p"],
        script: "s/\\c\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_2_bre",
        arguments: ["-n", "-e", "s/\\c\\/X/p"],
        script: "s/\\c\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_3_bre",
        arguments: ["-n", "-e", "s/\\c\\\\./X/p"],
        script: "s/\\c\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_4_bre",
        arguments: ["-n", "-e", "s/\\c\\\\c/X/p"],
        script: "s/\\c\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_5_bre",
        arguments: ["-n", "-e", "s/\\c\\\\/X/p"],
        script: "s/\\c\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_6_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\./X/p"],
        script: "s/\\c\\\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_7_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\c/X/p"],
        script: "s/\\c\\\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_8_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\/X/p"],
        script: "s/\\c\\\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_9_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\\\./X/p"],
        script: "s/\\c\\\\\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_10_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\\\c/X/p"],
        script: "s/\\c\\\\\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 13: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_11_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\\\/X/p"],
        script: "s/\\c\\\\\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_12_bre",
        arguments: ["-n", "-e", "s/[\\c\\.]/X/p"],
        script: "s/[\\c\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_13_bre",
        arguments: ["-n", "-e", "s/[\\c\\c]/X/p"],
        script: "s/[\\c\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_14_bre",
        arguments: ["-n", "-e", "s/[\\c\\]/X/p"],
        script: "s/[\\c\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_15_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\.]/X/p"],
        script: "s/[\\c\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_16_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\c]/X/p"],
        script: "s/[\\c\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_17_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\]/X/p"],
        script: "s/[\\c\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_18_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\.]/X/p"],
        script: "s/[\\c\\\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_19_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\c]/X/p"],
        script: "s/[\\c\\\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 14: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "p15_control_escape_20_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\]/X/p"],
        script: "s/[\\c\\\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_21_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\\\.]/X/p"],
        script: "s/[\\c\\\\\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_22_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\\\c]/X/p"],
        script: "s/[\\c\\\\\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_23_bre",
        arguments: ["-n", "-e", "s/[\\c\\\\\\\\]/X/p"],
        script: "s/[\\c\\\\\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_24_bre",
        arguments: ["-n", "-e", "s/a/\\c\\./p"],
        script: "s/a/\\c\\./p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_25_bre",
        arguments: ["-n", "-e", "s/a/\\c\\c/p"],
        script: "s/a/\\c\\c/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_26_bre",
        arguments: ["-n", "-e", "s/a/\\c\\/p"],
        script: "s/a/\\c\\/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_27_bre",
        arguments: ["-n", "-e", "s/a/\\c\\\\./p"],
        script: "s/a/\\c\\\\./p",
        input: "a\n",
        stdout: "\u001c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_28_bre",
        arguments: ["-n", "-e", "s/a/\\c\\\\c/p"],
        script: "s/a/\\c\\\\c/p",
        input: "a\n",
        stdout: "\u001cc\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_29_bre",
        arguments: ["-n", "-e", "s/a/\\c\\\\/p"],
        script: "s/a/\\c\\\\/p",
        input: "a\n",
        stdout: "\u001c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_36_bre",
        arguments: ["-n", "-e", "a \\c\\."],
        script: "a \\c\\.",
        input: "a\n",
        stdout: "c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_37_bre",
        arguments: ["-n", "-e", "a \\c\\c"],
        script: "a \\c\\c",
        input: "a\n",
        stdout: "cJ",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_38_bre",
        arguments: ["-n", "-e", "a \\c\\"],
        script: "a \\c\\",
        input: "a\n",
        stdout: "c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_39_bre",
        arguments: ["-n", "-e", "a \\c\\\\."],
        script: "a \\c\\\\.",
        input: "a\n",
        stdout: "c\\.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_40_bre",
        arguments: ["-n", "-e", "a \\c\\\\c"],
        script: "a \\c\\\\c",
        input: "a\n",
        stdout: "c\\c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_41_bre",
        arguments: ["-n", "-e", "a \\c\\\\"],
        script: "a \\c\\\\",
        input: "a\n",
        stdout: "c\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_48_bre",
        arguments: ["-n", "-e", "y/\\c\\./X/"],
        script: "y/\\c\\./X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_49_bre",
        arguments: ["-n", "-e", "y/\\c\\c/X/"],
        script: "y/\\c\\c/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_50_bre",
        arguments: ["-n", "-e", "y/\\c\\/X/"],
        script: "y/\\c\\/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unterminated 'y' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_51_bre",
        arguments: ["-n", "-e", "y/\\c\\\\./X/"],
        script: "y/\\c\\\\./X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_52_bre",
        arguments: ["-n", "-e", "y/\\c\\\\c/X/"],
        script: "y/\\c\\\\c/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_53_bre",
        arguments: ["-n", "-e", "y/\\c\\\\/X/"],
        script: "y/\\c\\\\/X/",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_60_bre",
        arguments: ["-n", "-e", "y/a/\\c\\./"],
        script: "y/a/\\c\\./",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_61_bre",
        arguments: ["-n", "-e", "y/a/\\c\\c/"],
        script: "y/a/\\c\\c/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_62_bre",
        arguments: ["-n", "-e", "y/a/\\c\\/"],
        script: "y/a/\\c\\/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unterminated 'y' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_63_bre",
        arguments: ["-n", "-e", "y/a/\\c\\\\./"],
        script: "y/a/\\c\\\\./",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_64_bre",
        arguments: ["-n", "-e", "y/a/\\c\\\\c/"],
        script: "y/a/\\c\\\\c/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_65_bre",
        arguments: ["-n", "-e", "y/a/\\c\\\\/"],
        script: "y/a/\\c\\\\/",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_72_bre",
        arguments: ["-n", "-e", "sc\\c\\.cXcp"],
        script: "sc\\c\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_73_bre",
        arguments: ["-n", "-e", "sc\\c\\ccXcp"],
        script: "sc\\c\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "p15_control_escape_74_bre",
        arguments: ["-n", "-e", "sc\\c\\cXcp"],
        script: "sc\\c\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_75_bre",
        arguments: ["-n", "-e", "sc\\c\\\\.cXcp"],
        script: "sc\\c\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_76_bre",
        arguments: ["-n", "-e", "sc\\c\\\\ccXcp"],
        script: "sc\\c\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_77_bre",
        arguments: ["-n", "-e", "sc\\c\\\\cXcp"],
        script: "sc\\c\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_78_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\.cXcp"],
        script: "sc\\c\\\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_79_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\ccXcp"],
        script: "sc\\c\\\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "p15_control_escape_80_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\cXcp"],
        script: "sc\\c\\\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_81_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\\\.cXcp"],
        script: "sc\\c\\\\\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_82_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\\\ccXcp"],
        script: "sc\\c\\\\\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 13: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_83_bre",
        arguments: ["-n", "-e", "sc\\c\\\\\\\\cXcp"],
        script: "sc\\c\\\\\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_context_0_bre",
        arguments: ["-n", "-e", "/\\c\\./p"],
        script: "/\\c\\./p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_1_bre",
        arguments: ["-n", "-e", "\\c\\c\\.cp"],
        script: "\\c\\c\\.cp",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_context_2_bre",
        arguments: ["-n", "-e", "sc\\cccxc"],
        script: "sc\\cccxc",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_context_3_bre",
        arguments: ["-n", "-e", "s/[[:a\\c\\.:]]/x/"],
        script: "s/[[:a\\c\\.:]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 16: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_4_bre",
        arguments: ["-n", "-e", "s/a{\\c\\}/x/"],
        script: "s/a{\\c\\}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_5_bre",
        arguments: ["-n", "-e", "s/\\x5cc\\./x/"],
        script: "s/\\x5cc\\./x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_2_ere",
        arguments: ["-n", "-E", "-e", "+b"],
        script: "+b",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_4_ere",
        arguments: ["-n", "-E", "-e", "~0p"],
        script: "~0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_5_ere",
        arguments: ["-n", "-E", "-e", "+00p"],
        script: "+00p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_6_ere",
        arguments: ["-n", "-E", "-e", "+3p"],
        script: "+3p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "p15_address_extension_7_ere",
        arguments: ["-n", "-E", "-e", "~12p"],
        script: "~12p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: invalid usage of +N or ~N as first address\n",
        status: 1,
      },
      {
        name: "p15_address_extension_8_ere",
        arguments: ["-n", "-E", "-e", "+ 00p"],
        script: "+ 00p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_9_ere",
        arguments: ["-n", "-E", "-e", "1~p"],
        script: "1~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_10_ere",
        arguments: ["-n", "-E", "-e", "1~0p"],
        script: "1~0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_11_ere",
        arguments: ["-n", "-E", "-e", "1,+p"],
        script: "1,+p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_12_ere",
        arguments: ["-n", "-E", "-e", "1,~p"],
        script: "1,~p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_13_ere",
        arguments: ["-n", "-E", "-e", "1,+0p"],
        script: "1,+0p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_14_ere",
        arguments: ["-n", "-E", "-e", "+,2p"],
        script: "+,2p",
        input: "a\n",
        stdout: "a\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_address_extension_15_ere",
        arguments: ["-n", "-E", "-e", "+:label"],
        script: "+:label",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 2: : doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "p15_address_extension_16_ere",
        arguments: ["-n", "-E", "-e", "{+}"],
        script: "{+}",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 3: '}' doesn't want any addresses\n",
        status: 1,
      },
      {
        name: "p15_control_escape_0_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\./X/p"],
        script: "s/\\c\\./X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_1_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\c/X/p"],
        script: "s/\\c\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_2_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\/X/p"],
        script: "s/\\c\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_3_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\./X/p"],
        script: "s/\\c\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_4_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\c/X/p"],
        script: "s/\\c\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_5_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\/X/p"],
        script: "s/\\c\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_6_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\./X/p"],
        script: "s/\\c\\\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_7_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\c/X/p"],
        script: "s/\\c\\\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_8_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\/X/p"],
        script: "s/\\c\\\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_9_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\\\./X/p"],
        script: "s/\\c\\\\\\\\./X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_10_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\\\c/X/p"],
        script: "s/\\c\\\\\\\\c/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 13: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_11_ere",
        arguments: ["-n", "-E", "-e", "s/\\c\\\\\\\\/X/p"],
        script: "s/\\c\\\\\\\\/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_12_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\.]/X/p"],
        script: "s/[\\c\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_13_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\c]/X/p"],
        script: "s/[\\c\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_14_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\]/X/p"],
        script: "s/[\\c\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_15_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\.]/X/p"],
        script: "s/[\\c\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_16_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\c]/X/p"],
        script: "s/[\\c\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_17_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\]/X/p"],
        script: "s/[\\c\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_18_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\.]/X/p"],
        script: "s/[\\c\\\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_19_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\c]/X/p"],
        script: "s/[\\c\\\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 14: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "p15_control_escape_20_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\]/X/p"],
        script: "s/[\\c\\\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_21_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\\\.]/X/p"],
        script: "s/[\\c\\\\\\\\.]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_22_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\\\c]/X/p"],
        script: "s/[\\c\\\\\\\\c]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_23_ere",
        arguments: ["-n", "-E", "-e", "s/[\\c\\\\\\\\]/X/p"],
        script: "s/[\\c\\\\\\\\]/X/p",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_24_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\./p"],
        script: "s/a/\\c\\./p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_25_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\c/p"],
        script: "s/a/\\c\\c/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_26_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\/p"],
        script: "s/a/\\c\\/p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_27_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\\\./p"],
        script: "s/a/\\c\\\\./p",
        input: "a\n",
        stdout: "\u001c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_28_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\\\c/p"],
        script: "s/a/\\c\\\\c/p",
        input: "a\n",
        stdout: "\u001cc\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_29_ere",
        arguments: ["-n", "-E", "-e", "s/a/\\c\\\\/p"],
        script: "s/a/\\c\\\\/p",
        input: "a\n",
        stdout: "\u001c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_36_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\."],
        script: "a \\c\\.",
        input: "a\n",
        stdout: "c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_37_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\c"],
        script: "a \\c\\c",
        input: "a\n",
        stdout: "cJ",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_38_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\"],
        script: "a \\c\\",
        input: "a\n",
        stdout: "c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_39_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\\\."],
        script: "a \\c\\\\.",
        input: "a\n",
        stdout: "c\\.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_40_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\\\c"],
        script: "a \\c\\\\c",
        input: "a\n",
        stdout: "c\\c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_41_ere",
        arguments: ["-n", "-E", "-e", "a \\c\\\\"],
        script: "a \\c\\\\",
        input: "a\n",
        stdout: "c\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_48_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\./X/"],
        script: "y/\\c\\./X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_49_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\c/X/"],
        script: "y/\\c\\c/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_50_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\/X/"],
        script: "y/\\c\\/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unterminated 'y' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_51_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\\\./X/"],
        script: "y/\\c\\\\./X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_52_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\\\c/X/"],
        script: "y/\\c\\\\c/X/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_53_ere",
        arguments: ["-n", "-E", "-e", "y/\\c\\\\/X/"],
        script: "y/\\c\\\\/X/",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_60_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\./"],
        script: "y/a/\\c\\./",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_61_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\c/"],
        script: "y/a/\\c\\c/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_escape_62_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\/"],
        script: "y/a/\\c\\/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unterminated 'y' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_63_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\\\./"],
        script: "y/a/\\c\\\\./",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_64_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\\\c/"],
        script: "y/a/\\c\\\\c/",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: 'y' command strings have different lengths\n",
        status: 1,
      },
      {
        name: "p15_control_escape_65_ere",
        arguments: ["-n", "-E", "-e", "y/a/\\c\\\\/"],
        script: "y/a/\\c\\\\/",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_72_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\.cXcp"],
        script: "sc\\c\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_73_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\ccXcp"],
        script: "sc\\c\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "p15_control_escape_74_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\cXcp"],
        script: "sc\\c\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_75_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\.cXcp"],
        script: "sc\\c\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_76_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\ccXcp"],
        script: "sc\\c\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_77_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\cXcp"],
        script: "sc\\c\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_78_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\.cXcp"],
        script: "sc\\c\\\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_79_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\ccXcp"],
        script: "sc\\c\\\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 10: unknown option to 's'\n",
        status: 1,
      },
      {
        name: "p15_control_escape_80_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\cXcp"],
        script: "sc\\c\\\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: Trailing backslash\n",
        status: 1,
      },
      {
        name: "p15_control_escape_81_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\\\.cXcp"],
        script: "sc\\c\\\\\\\\.cXcp",
        input: "a\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_escape_82_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\\\ccXcp"],
        script: "sc\\c\\\\\\\\ccXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 13: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_escape_83_ere",
        arguments: ["-n", "-E", "-e", "sc\\c\\\\\\\\cXcp"],
        script: "sc\\c\\\\\\\\cXcp",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 12: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "p15_control_context_0_ere",
        arguments: ["-n", "-E", "-e", "/\\c\\./p"],
        script: "/\\c\\./p",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_1_ere",
        arguments: ["-n", "-E", "-e", "\\c\\c\\.cp"],
        script: "\\c\\c\\.cp",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_context_2_ere",
        arguments: ["-n", "-E", "-e", "sc\\cccxc"],
        script: "sc\\cccxc",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "p15_control_context_3_ere",
        arguments: ["-n", "-E", "-e", "s/[[:a\\c\\.:]]/x/"],
        script: "s/[[:a\\c\\.:]]/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 16: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_4_ere",
        arguments: ["-n", "-E", "-e", "s/a{\\c\\}/x/"],
        script: "s/a{\\c\\}/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 11: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "p15_control_context_5_ere",
        arguments: ["-n", "-E", "-e", "s/\\x5cc\\./x/"],
        script: "s/\\x5cc\\./x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_shell_continuation_bre",
        arguments: ["-n", "-e", "e x\\\npp"],
        script: "e x\\\npp",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_shell_escaped_backslash_newline_bre",
        arguments: ["-n", "-e", "e x\\\\\npp"],
        script: "e x\\\\\npp",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 8: extra characters after command\n",
        status: 1,
      },
      {
        name: "audit_shell_paired_backslash_continuation_bre",
        arguments: ["-n", "-e", "e x\\\\\\\npp"],
        script: "e x\\\\\\\npp",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_replacement_control_escaped_newline_bre",
        arguments: ["-n", "-e", "s/a/\\c\\\ny/p"],
        script: "s/a/\\c\\\ny/p",
        input: "a\n",
        stdout: "Jy\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_translation_control_escaped_newline_bre",
        arguments: ["-n", "-e", "y/ab/x\\c\\\n/;p"],
        script: "y/ab/x\\c\\\n/;p",
        input: "ab\n",
        stdout: "xJ\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_pattern_control_escaped_newline_bre",
        arguments: ["-n", "-e", "s/a\\c\\\n/x/"],
        script: "s/a\\c\\\n/x/",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 6: unterminated 's' command\n",
        status: 1,
      },
      {
        name: "audit_replacement_control_escaped_slash_bre",
        arguments: ["-n", "-e", "s/a/\\c\\//p"],
        script: "s/a/\\c\\//p",
        input: "a\n",
        stdout: "o\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_replacement_escaped_ampersand_delimiter_bre",
        arguments: ["-n", "-e", "s&a&x\\&y&p"],
        script: "s&a&x\\&y&p",
        input: "a\n",
        stdout: "x&y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_replacement_control_escaped_ampersand_bre",
        arguments: ["-n", "-e", "s&a&\\c\\&&"],
        script: "s&a&\\c\\&&",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "audit_translation_control_escaped_ampersand_bre",
        arguments: ["-n", "-e", "y&a&\\c\\&&"],
        script: "y&a&\\c\\&&",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 9: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "audit_text_raw_leadin_backslash_bre",
        arguments: ["-n", "-e", "a\\\\\np"],
        script: "a\\\\\np",
        input: "L1\n",
        stdout: "L1\n\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_text_backslash_after_raw_leadin_bre",
        arguments: ["-n", "-e", "a\\\\\\\np"],
        script: "a\\\\\\\np",
        input: "L1\n",
        stdout: "\\\np\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_text_raw_leadin_before_command_bre",
        arguments: ["-n", "-e", "i\\\\\n\\bb"],
        script: "i\\\\\n\\bb",
        input: "",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: -e expression #1, char 7: missing command\n",
        status: 1,
      },
      {
        name: "audit_pattern_paired_control_backslashes_bre",
        arguments: ["-n", "-e", "s/\\c\\\\\\c\\\\/x/"],
        script: "s/\\c\\\\\\c\\\\/x/",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_zero_first_step_ending_in_zero_read_bre",
        arguments: ["-n", "-e", "0~10r x"],
        script: "0~10r x",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_zero_first_step_ending_in_zero_range_bre",
        arguments: ["-n", "-e", "0~100,/b/p"],
        script: "0~100,/b/p",
        input: "",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_class_name_digitless_escape_bre",
        arguments: ["-n", "-e", "s/[[:\\digit:]]/Y/gp"],
        script: "s/[[:\\digit:]]/Y/gp",
        input: "a1b2\n",
        stdout: "aYbY\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_collating_digitless_escape_bre",
        arguments: ["-n", "-e", "s/[[.\\x.]]/Y/p"],
        script: "s/[[.\\x.]]/Y/p",
        input: "x\n",
        stdout: "Y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_unpaired_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "ax\\c\\.",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_text_control_continued_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "a x\\c\\\np",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_text_control_paired_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "ax\\c\\\\.",
        input: "a{1}\na{\na\n",
        stdout: "x\u001c.\nx\u001c.\nx\u001c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_trailing_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "ax\\c\\",
        input: "a{1}\na{\na\n",
        stdout: "x\\c\nx\\c\nx\\c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_multiline_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "a\\\nx\\c\\.",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_nul_substitute_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s\u0000a\u0000b\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_translate_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "y\u0000a\u0000b\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_address_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "\\\u0000a\u0000p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_read_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "r \u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_read_line_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "R\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_write_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "w \u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_write_line_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "W\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_flag_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a/b/w \u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_internal_filename_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "r x\u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_read_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_omitted_step_read_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_spaced_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "00 ~ 00r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_range_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0,/a/p",
        input: "a{1}\na{\na\n",
        stdout: "a{1}\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_omitted_step_range_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~,/a/p",
        input: "a{1}\na{\na\n",
        stdout: "a{1}\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_negated_range_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0,/a/!p",
        input: "a{1}\na{\na\n",
        stdout: "a{\na\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_print_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_zero_step_negated_read_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0!r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_zero_step_numeric_range_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "0~0,1p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_interval_control_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\{1\\n\\}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "review_seven_interval_escaped_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\{1\\q\\}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "review_seven_interval_encoded_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\{1\\x61\\}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "review_seven_boundary_interval_0_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\{/x/p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: invalid content of \\{\\}\n",
        status: 4,
      },
      {
        name: "review_seven_boundary_interval_1_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/\\b\\{/x/p",
        input: "a{1}\na{\na\n",
        stdout: "ax1}\nax\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_boundary_interval_2_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\{1\\}/x/p",
        input: "a{1}\na{\na\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_boundary_interval_3_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\{x\\}/x/p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: invalid content of \\{\\}\n",
        status: 4,
      },
      {
        name: "review_seven_boundary_interval_4_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\B\\{/x/p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: invalid content of \\{\\}\n",
        status: 4,
      },
      {
        name: "review_seven_boundary_interval_5_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/\\(a\\)\\b\\{/x/p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "/opt/homebrew/bin/gsed: invalid content of \\{\\}\n",
        status: 4,
      },
      {
        name: "review_seven_boundary_interval_6_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\|\\b\\{/x/p",
        input: "a{1}\na{\na\n",
        stdout: "x{1}\nx{\nx\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_boundary_interval_7_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/\\(\\b\\{\\)/x/p",
        input: "a{1}\na{\na\n",
        stdout: "ax1}\nax\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_boundary_interval_8_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\{,\\}/x/p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_boundary_interval_9_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/a\\b\\{\\x31\\}/x/p",
        input: "a{1}\na{\na\n",
        stdout: "x\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_unpaired_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "ax\\c\\.",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_text_control_continued_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "a x\\c\\\np",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_text_control_paired_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "ax\\c\\\\.",
        input: "a{1}\na{\na\n",
        stdout: "x\u001c.\nx\u001c.\nx\u001c.\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_trailing_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "ax\\c\\",
        input: "a{1}\na{\na\n",
        stdout: "x\\c\nx\\c\nx\\c\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_text_control_multiline_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "a\\\nx\\c\\.",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "review_seven_nul_substitute_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s\u0000a\u0000b\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_translate_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "y\u0000a\u0000b\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_address_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "\\\u0000a\u0000p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: delimiter character is not a single-byte character\n",
        status: 1,
      },
      {
        name: "review_seven_nul_read_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "r \u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_read_line_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "R\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_write_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "w \u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_write_line_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "W\u0000",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_flag_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s/a/b/w \u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: missing filename in r/R/w/W commands\n",
        status: 1,
      },
      {
        name: "review_seven_nul_internal_filename_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "r x\u0000tail",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_read_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_omitted_step_read_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_spaced_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "00 ~ 00r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_range_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0,/a/p",
        input: "a{1}\na{\na\n",
        stdout: "a{1}\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_omitted_step_range_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~,/a/p",
        input: "a{1}\na{\na\n",
        stdout: "a{1}\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_negated_range_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0,/a/!p",
        input: "a{1}\na{\na\n",
        stdout: "a{\na\n",
        stderr: "",
        status: 0,
      },
      {
        name: "review_seven_zero_step_print_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_zero_step_negated_read_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0!r x",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_zero_step_numeric_range_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "0~0,1p",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: invalid usage of line address 0\n",
        status: 1,
      },
      {
        name: "review_seven_interval_control_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s/a{1\\n}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "review_seven_interval_escaped_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s/a{1\\q}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "review_seven_interval_encoded_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s/a{1\\x61}/x/",
        input: "a{1}\na{\na\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid content of \\{\\}\n",
        status: 1,
      },
      {
        name: "audit_paired_control_escaped_hex_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "sx\\c\\\\\\\\x5dxYxp",
        input: "\u001c]\n\u001cx5d\n",
        stdout: "Y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_escaped_hex_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "sx\\c\\\\\\\\x5dxYxp",
        input: "\u001c]\n\u001cx5d\n",
        stdout: "Y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_escaped_tab_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "st\\c\\\\\\\\ttYtp",
        input: "\u001c\t\n\u001ct\n",
        stdout: "Y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_escaped_tab_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "st\\c\\\\\\\\ttYtp",
        input: "\u001c\t\n\u001ct\n",
        stdout: "Y\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_escaped_bracket_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "sx\\c\\\\\\\\x5bxYxp",
        input: "\u001c[\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid regular expression\n",
        status: 1,
      },
      {
        name: "audit_paired_control_escaped_bracket_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "sx\\c\\\\\\\\x5bxYxp",
        input: "\u001c[\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid regular expression\n",
        status: 1,
      },
      {
        name: "audit_control_pair_before_escaped_newline_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "N;s/\\c\\\\\n/X/p",
        input: "\u001c\n\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "audit_control_pair_before_escaped_newline_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "N;s/\\c\\\\\n/X/p",
        input: "\u001c\n\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 2: recursive escaping after \\c not allowed\n",
        status: 1,
      },
      {
        name: "audit_paired_control_escaped_newline_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "N;s/\\c\\\\\\\\\n/X/p",
        input: "\u001c\n\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_escaped_newline_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "N;s/\\c\\\\\\\\\n/X/p",
        input: "\u001c\n\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_encoded_bracket_escaped_newline_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "N;s/a\\x5b\\\n]b/X/p",
        input: "a\nb\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_encoded_bracket_escaped_newline_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "N;s/a\\x5b\\\n]b/X/p",
        input: "a\nb\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_control_argument_escaped_newline_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "N;sca\\c\\\\\ncQcp",
        input: "ac\n\n",
        stdout: "Q\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_control_argument_escaped_newline_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "N;sca\\c\\\\\ncQcp",
        input: "ac\n\n",
        stdout: "Q\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_offset_control_escaped_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "s/\\c\\\\\\c\\//Q/p",
        input: "\u001co\n",
        stdout: "Q\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_offset_control_escaped_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "s/\\c\\\\\\c\\//Q/p",
        input: "\u001co\n",
        stdout: "Q\n",
        stderr: "",
        status: 0,
      },
      {
        name: "audit_paired_control_bracket_letter_delimiter_bre",
        arguments: ["-n", "-f", "script.sed"],
        script: "st\\x5b\\c\\\\\\tQtp",
        input: "\u001c\\\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "audit_paired_control_bracket_letter_delimiter_ere",
        arguments: ["-n", "-E", "-f", "script.sed"],
        script: "st\\x5b\\c\\\\\\tQtp",
        input: "\u001c\\\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Unmatched [, [^, [:, [., or [=\n",
        status: 1,
      },
      {
        name: "backslash_address_matches",
        script: "\\\\b\\p",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "b\n",
        stderr: "",
        status: 0,
        input: "b\n",
      },
      {
        name: "text_eof_backslash_preserves_tab_escape",
        script: "a x\\t\\",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "x\\t\n",
        stderr: "",
        status: 0,
        input: "q\n",
      },
      {
        name: "text_eof_backslash_preserves_control_escape",
        script: "a x\\c\\.\\",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "x\\c\\.\n",
        stderr: "",
        status: 0,
        input: "q\n",
      },
      {
        name: "terminated_text_decodes_tab_escape",
        script: "a x\\t\n",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "x\t\n",
        stderr: "",
        status: 0,
        input: "q\n",
      },
      {
        name: "execute_operand_decodes_tab_escape",
        script: "e printf '%s' 'x\\ty' ",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "x\ty",
        stderr: "",
        status: 0,
        input: "q\n",
      },
      {
        name: "execute_operand_decodes_hexadecimal_escape",
        script: "e printf '%s' '\\x41' ",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "A",
        stderr: "",
        status: 0,
        input: "q\n",
      },
      {
        name: "execute_operand_rejects_recursive_control_escape",
        script: "e x\\c\\y",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: recursive escaping after \\c not allowed\n",
        status: 1,
        input: "",
      },
      {
        name: "regex_numeric_digit_from_escaped_delimiter",
        script: "s5\\x\\55X5p",
        arguments: ["-n", "-f", "script.sed"],
        stdout: "X\n",
        stderr: "",
        status: 0,
        input: "\u0005\n",
      },
      {
        name: "text_odd_3",
        arguments: ["-n", "-f", "script.sed"],
        script: "a x\\t\\\\\\",
        input: "q\n",
        stdout: "x\\t\\\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "text_even_2",
        arguments: ["-n", "-f", "script.sed"],
        script: "a x\\t\\\\",
        input: "q\n",
        stdout: "x\t\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "text_continued_raw",
        arguments: ["-n", "-f", "script.sed"],
        script: "a x\\t\\\ny\\n\\",
        input: "q\n",
        stdout: "x\\t\\\ny\\n\n",
        stderr: "",
        status: 0,
      },
      {
        name: "text_raw_leadin",
        arguments: ["-n", "-f", "script.sed"],
        script: "a\\\\t\\",
        input: "q\n",
        stdout: "\\t\n",
        stderr: "",
        status: 0,
      },
      {
        name: "shell_raw",
        arguments: ["-n", "-f", "script.sed"],
        script: "e printf '%s' 'x\\ty' \\",
        input: "q\n",
        stdout: "x\\ty",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_not_delimiter",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5\\x\\65X5p",
        input: "x6\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: Invalid back reference\n",
        status: 1,
      },
      {
        name: "digit_second",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5\\x6\\55X5p",
        input: "e\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_twice",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5\\x\\5\\55X5p",
        input: "U\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_replacement",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5a5\\x\\55p",
        input: "a\n",
        stdout: "\u0005\n",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_translation",
        arguments: ["-n", "-f", "script.sed"],
        script: "y5\\x\\55X5;p",
        input: "\u0005\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "digit_bracket",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5[\\x\\5]5X5p",
        input: "x\\5\n",
        stdout: "X\\5\n",
        stderr: "",
        status: 0,
      },
      {
        name: "slash_pattern",
        arguments: ["-n", "-f", "script.sed"],
        script: "s\\\\\\p",
        input: "a\n",
        stdout: "",
        stderr:
          "/opt/homebrew/bin/gsed: file script.sed line 1: no previous regular expression\n",
        status: 1,
      },
      {
        name: "slash_bracket",
        arguments: ["-n", "-f", "script.sed"],
        script: "s\\[\\t]\\X\\p",
        input: "\t\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "backslash_substitution_output",
        arguments: ["-n", "-f", "script.sed"],
        script: "s\\b\\X\\p",
        input: "b\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "backslash_translation_output",
        arguments: ["-n", "-f", "script.sed"],
        script: "y\\abc\\xyz\\;p",
        input: "abc\n",
        stdout: "xyz\n",
        stderr: "",
        status: 0,
      },
      {
        name: "text_leadin_terminal_pair",
        arguments: ["-n", "-f", "script.sed"],
        script: "a\\\\\\",
        input: "q\n",
        stdout: "\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "text_leadin_terminal_triple",
        arguments: ["-n", "-f", "script.sed"],
        script: "a\\\\\\\\",
        input: "q\n",
        stdout: "\\\n",
        stderr: "",
        status: 0,
      },
      {
        name: "shell_initial_numeric_escape",
        arguments: ["-n", "-f", "script.sed"],
        script: "e \\x70rintf '%s' 'ok'",
        input: "q\n",
        stdout: "",
        stderr: "sh: x70rintf: command not found\n",
        status: 0,
      },
      {
        name: "text_continued_decoded",
        arguments: ["-n", "-f", "script.sed"],
        script: "a x\\t\\\ny\\n",
        input: "q\n",
        stdout: "x\t\ny\n\n",
        stderr: "",
        status: 0,
      },
      {
        name: "numeric_decimal_delimiter",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5\\d6\\55X5p",
        input: "A\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
      {
        name: "numeric_octal_delimiter",
        arguments: ["-n", "-f", "script.sed"],
        script: "s5\\o10\\55X5p",
        input: "E\n",
        stdout: "X\n",
        stderr: "",
        status: 0,
      },
    ],
  };
  if (process.platform !== "darwin") {
    t.skip("These GNU sed diagnostics were recorded on macOS");
    return;
  }
  const expectedVersion = observations.version
    .replace(observations.executable, "")
    .trim();
  const executable = (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => [join(directory, "gsed"), join(directory, "sed")])
    .find((candidate) => {
      if (!existsSync(candidate)) return false;
      const version = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        env: observations.environment,
        timeout: 10_000,
      });
      return (
        version.status === 0 &&
        version.stdout.split("\n")[0].endsWith(expectedVersion)
      );
    });
  if (executable === undefined) {
    t.skip(`${expectedVersion} is required for these observations`);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "gsed-observations-"));
  try {
    for (const observation of observations.cases) {
      const cwd = mkdtempSync(join(directory, "case-"));
      const fileIndex = observation.arguments.indexOf("-f");
      const scriptFile =
        fileIndex < 0 ? undefined : observation.arguments[fileIndex + 1];
      if (scriptFile !== undefined && scriptFile !== "-") {
        writeFileSync(join(cwd, scriptFile), observation.script);
      }
      const result = spawnSync(executable, observation.arguments, {
        cwd,
        env: observations.environment,
        input: scriptFile === "-" ? observation.script : observation.input,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, observation.status, observation.name);
      assert.equal(result.stdout, observation.stdout, observation.name);
      assert.equal(
        result.stderr,
        observation.stderr.replaceAll(observations.executable, executable),
        observation.name,
      );
    }
    t.diagnostic(
      `${observations.version} on ${observations.os}: ${observations.cases.length} observations match`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
