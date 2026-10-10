export const symbols = [
  "group_open",
  "group_close",
  "alternation",
  "quantifier",
  "interval_open",
  "interval_close",
  "bracket_open",
  "bracket_close",
  "bracket_negation",
  "range_dash",
  "regex_dot",
  "regex_anchor",
  "regex_boundary",
  "regex_class_escape",
  "regex_backreference",
  "interval_comma",
  "invalid_regex_operator",
  "unmatched_group_close",
  "orphan_interval_open",
  "invalid_range_operator",
  "invalid_interval_character",
  "invalid_interval_syntax",
  "incomplete_interval_syntax",
  "class_open",
  "collating_open",
  "equivalence_open",
  "term_open_marker",
  "term_close_marker",
  "term_close",
  "misplaced_class_start",
  "term_text",
];

export const tokens = [
  ...symbols.map((name) => `${name}_escaped`),
  "count_encoded",
  "count_escaped",
  "interval_comma_encoded",
  "error_sentinel",
  "opaque_end",
  "blank",
  "block_close",
  "comment_end",
  "zero_number",
  "pending_zero",
  "invalid_zero",
  "address_gap",
  "first_address_gap",
  "regex_start",
  "invalid_address_prefix",
  "pattern_start",
  "regex_end",
  "pattern_end",
  "replacement_end",
  "translation_start",
  "translation_middle",
  "translation_end",
  "regex_character",
  "regex_escape",
  "regex_character_escape",
  "regex_dot",
  "regex_anchor",
  "regex_boundary",
  "regex_class_escape",
  "regex_backreference",
  "group_open",
  "group_open_encoded",
  "group_close",
  "group_close_encoded",
  "alternation",
  "alternation_encoded",
  "quantifier",
  "quantifier_encoded",
  "interval_open",
  "interval_open_encoded",
  "interval_close",
  "interval_close_encoded",
  "count",
  "interval_comma",
  "invalid_interval_character",
  "invalid_interval_character_encoded",
  "invalid_interval_syntax",
  "invalid_interval_syntax_encoded",
  "incomplete_interval_syntax",
  "incomplete_interval_syntax_encoded",
  "bracket_open",
  "bracket_open_encoded",
  "bracket_close",
  "bracket_close_encoded",
  "bracket_negation",
  "bracket_negation_encoded",
  "bracket_character",
  "bracket_escape",
  "bracket_character_escape",
  "range_dash",
  "range_dash_encoded",
  "class_open",
  "collating_open",
  "equivalence_open",
  "term_close",
  "term_close_encoded",
  "term_open_marker",
  "term_open_marker_encoded",
  "term_close_marker",
  "term_close_marker_encoded",
  "class_open_encoded",
  "misplaced_class_start",
  "misplaced_class_start_encoded",
  "collating_open_encoded",
  "equivalence_open_encoded",
  "term_nonempty",
  "class_valid",
  "class_invalid",
  "class_incomplete",
  "term_text",
  "term_escape",
  "literal",
  "escape",
  "character_escape",
  "backreference",
  "match_reference",
  "case_conversion",
  "text_start",
  "text_end",
  "line_continuation",
  "filename",
  "label",
  "shell_start",
  "inline_shell_start",
  "comment",
  "directive",
  "command_end",
  "end_of_input",
  "boundary",
  "invalid_delimiter",
  "unterminated_regex_eof",
  "unterminated_regex_line",
  "unterminated_operand_eof",
  "unterminated_operand_line",
  "incomplete_escape",
  "invalid_escape",
  "invalid_control_escape",
  "incomplete_control_escape",
  "invalid_encoding",
  "nul_command",
  "empty_label",
  "empty_filename",
  "invalid_regex_operator",
  "invalid_regex_operator_encoded",
  "unmatched_group_close",
  "unmatched_group_close_encoded",
  "orphan_interval_open",
  "orphan_interval_open_encoded",
  "invalid_range_operator",
  "invalid_range_operator_encoded",
  "missing_separator",
  "number",
  "version",
  "global_flag",
  "print_flag",
  "evaluate_flag",
  "match_flag",
  "write_flag",
  "occurrence",
  "zero_occurrence",
  "unknown_flag",
  "address_modifier",
  "interval_nonempty",
  "interval_empty",
  "interval_empty_eof",
  "inline_text_start",
  "comment_tail",
  "separator",
  "regex_dot_encoded",
  "regex_anchor_encoded",
  "regex_boundary_encoded",
  "regex_class_escape_encoded",
  "regex_backreference_encoded",
  "utf8_start",
  "utf8_continuation",
];

const definitions = [
  [
    "invalid_interval_syntax",
    "invalid",
    ($) => symbol($, "invalid_interval_syntax", "escape"),
  ],
  [
    "invalid_interval_syntax",
    "incomplete",
    ($) => symbol($, "incomplete_interval_syntax", "escape"),
  ],
  [
    "empty_filename",
    "invalid",
    ($) => leaf($, "empty_filename", "filename_text"),
  ],
  [
    "invalid_control_escape",
    "invalid",
    ($) => leaf($, "invalid_control_escape", "character_escape"),
  ],
  [
    "invalid_control_escape",
    "incomplete",
    ($) => leaf($, "incomplete_control_escape", "character_escape"),
  ],
  [
    "invalid_relative_address",
    "invalid",
    ($) => field("count", leaf($, "number", "number")),
  ],
  ["empty_label", "invalid", ($) => leaf($, "empty_label", "label_text")],
  ["first_address_gap", "invalid", ($) => $._first_address_gap],
  ["invalid_zero_address", "invalid", ($) => leaf($, "invalid_zero", "number")],
  [
    "misplaced_zero_address",
    "invalid",
    ($) => leaf($, "zero_number", "number"),
  ],
  [
    "invalid_zero_address",
    "incomplete",
    ($) => leaf($, "pending_zero", "number"),
  ],
  ["excess_range", "invalid", ($) => $._address_tail],
  ["forbidden_address", "invalid", ($) => field("address", $.address_clause)],
  ["unknown_substitution_flag", "invalid", ($) => $._unknown_flag],
  ...["global_flag", "print_flag", "occurrence"].map((token) => [
    `duplicate_${token}`,
    "invalid",
    ($) => leaf($, token, token === "occurrence" ? "number" : "flag"),
  ]),
  ["zero_occurrence", "invalid", ($) => leaf($, "zero_occurrence", "number")],
  ["zero_occurrence", "incomplete", ($) => leaf($, "pending_zero", "number")],
  ["duplicate_zero_occurrence", "invalid", ($) => zero($)],
  ["modifier_on_empty_regexp", "invalid", ($) => leaf($, "match_flag", "flag")],
  [
    "address_modifier_on_empty_regexp",
    "invalid",
    ($) => leaf($, "address_modifier", "address_modifier"),
  ],
  [
    "unknown_character_class",
    "invalid",
    ($) => seq($._class_invalid, alias($._class_payload, $.class_name)),
  ],
  [
    "unknown_character_class",
    "incomplete",
    ($) => seq($._class_incomplete, alias($._class_payload, $.class_name)),
  ],
  ["empty_interval", "invalid", ($) => $._interval_empty],
  ["empty_interval", "incomplete", ($) => $._interval_empty_eof],
  ["unmatched_closing_brace", "invalid", () => "}"],
  ["duplicate_negation", "invalid", () => "!"],
  [
    "unknown_command",
    "invalid",
    ($) => choice($._unknown_command, $._nul_command),
  ],
  ["missing_command_separator", "invalid", ($) => $._missing_separator],
  ["invalid_delimiter", "invalid", ($) => $._invalid_delimiter],
  [
    "invalid_interval_character",
    "invalid",
    ($) =>
      prec.right(repeat1(symbol($, "invalid_interval_character", "literal"))),
  ],
  [
    "invalid_regex_operator",
    "invalid",
    ($) => symbol($, "invalid_regex_operator", "regex_operator"),
  ],
  [
    "unmatched_group_close",
    "invalid",
    ($) => symbol($, "unmatched_group_close", "group_close"),
  ],
  [
    "orphan_interval",
    "invalid",
    ($) => symbol($, "orphan_interval_open", "interval_open"),
  ],
  ["invalid_encoding", "invalid", ($) => $._invalid_encoding],
  [
    "misplaced_character_class",
    "invalid",
    ($) =>
      seq(
        symbol($, "misplaced_class_start", "compound_marker"),
        alias($._class_payload, $.class_name),
        symbol($, "term_close_marker", "compound_marker"),
      ),
  ],
  [
    "invalid_range_endpoint",
    "invalid",
    ($) => choice($.character_class, $.equivalence_class),
  ],
  [
    "invalid_range_operator",
    "invalid",
    ($) => symbol($, "invalid_range_operator", "range_operator"),
  ],
  ["missing_escape_character", "incomplete", ($) => $._incomplete_escape],
  ["missing_escape_character", "invalid", ($) => $._invalid_escape],
  ["unterminated_regex", "incomplete", ($) => $._unterminated_regex_eof],
  ["unterminated_regex", "invalid", ($) => $._unterminated_regex_line],
  ["unterminated_operand", "incomplete", ($) => $._unterminated_operand_eof],
  ["unterminated_operand", "invalid", ($) => $._unterminated_operand_line],
  ...[
    "missing_command",
    "missing_operand",
    "missing_address",
    "missing_closing_delimiter",
    "missing_opening_delimiter",
    "missing_bracket_element",
  ].flatMap((reason) => [
    [reason, "incomplete", ($) => $._end_of_input],
    [
      reason,
      "invalid",
      ($) =>
        reason === "missing_address"
          ? choice($._boundary, $._address_gap)
          : $._boundary,
    ],
  ]),
];

function defineIssueRules(definitions) {
  const rules = {};
  for (const { id, outcome, reason, rule } of definitions) {
    rules[`_${id}_reason`] = rule;
    rules[`_${id}_outcome`] = ($) => alias($[`_${id}_reason`], $[reason]);
    rules[`_${id}_issue`] = ($) => alias($[`_${id}_outcome`], $[outcome]);
  }
  return rules;
}

const problem = ($, reason, outcome = "invalid") =>
  field("issue", alias($[`_${outcome}_${reason}_issue`], $.syntax_issue));
const missing = ($, reason) =>
  choice(problem($, reason), problem($, reason, "incomplete"));
const leaf = ($, token, name) => alias($[`_${token}`], $[name]);
const symbol = ($, name, type) =>
  choice(
    leaf($, name, type),
    leaf($, `${name}_encoded`, "character_escape"),
    leaf($, `${name}_escaped`, "escape"),
  );
const compoundClose = ($, type) =>
  choice(
    seq(
      symbol($, "term_close_marker", "compound_marker"),
      choice(
        symbol($, "term_close", type),
        missing($, "missing_closing_delimiter"),
      ),
    ),
    missing($, "missing_closing_delimiter"),
  );
const verb = ($, ...spellings) =>
  field(
    "name",
    alias(
      spellings.length === 1 ? spellings[0] : choice(...spellings),
      $.command_name,
    ),
  );
const excess = ($) => repeat(problem($, "excess_range"));
const zeroStep = ($) =>
  optional(
    seq(
      alias("~", $.address_operator),
      optional(field("step", leaf($, "zero_number", "number"))),
    ),
  );
const rootItem = ($) =>
  choice(
    $.command,
    $.command_separator,
    $._command_layout,
    $.comment,
    problem($, "invalid_encoding"),
    problem($, "unmatched_closing_brace"),
  );
const zero = ($) =>
  choice(
    problem($, "zero_occurrence"),
    problem($, "zero_occurrence", "incomplete"),
  );
const close = ($, name, type) =>
  choice(symbol($, name, type), missing($, "missing_closing_delimiter"));
const operandEnd = ($, token) =>
  choice(
    leaf($, token, "delimiter"),
    problem($, "unterminated_operand"),
    problem($, "unterminated_operand", "incomplete"),
  );
const regexEnd = ($, token) =>
  choice(
    leaf($, token, "delimiter"),
    problem($, "unterminated_regex"),
    problem($, "unterminated_regex", "incomplete"),
  );

function flagRules() {
  const rules = {};
  for (const empty of [false, true]) {
    for (let seen = 0; seen < 8; seen++) {
      rules[`_flags_${Number(empty)}_${seen}`] = ($) => {
        const transitions = [
          { kind: "global_flag", bit: 1 },
          { kind: "print_flag", bit: 2 },
          { kind: "occurrence", bit: 4 },
        ].map(({ kind, bit }) =>
          seq(
            seen & bit
              ? problem($, `duplicate_${kind}`)
              : alias($[`_${kind}`], kind === "occurrence" ? $.number : $.flag),
            optional($[`_flags_${Number(empty)}_${seen | bit}`]),
          ),
        );
        return prec.right(
          choice(
            ...transitions,
            seq(
              leaf($, "evaluate_flag", "flag"),
              optional($[`_flags_${Number(empty)}_${seen & ~2}`]),
            ),
            seq(
              empty
                ? problem($, "modifier_on_empty_regexp")
                : leaf($, "match_flag", "flag"),
              optional($[`_flags_${Number(empty)}_${seen}`]),
            ),
            seq(
              seen & 4 ? problem($, "duplicate_zero_occurrence") : zero($),
              optional($[`_flags_${Number(empty)}_${seen | 4}`]),
            ),
            seq(
              choice(
                problem($, "unknown_substitution_flag"),
                problem($, "invalid_encoding"),
              ),
              optional($[`_flags_${Number(empty)}_${seen}`]),
            ),
            $.write_flag,
          ),
        );
      };
    }
  }
  return rules;
}

export default function defineGrammar(name) {
  return grammar({
    name,
    extras: ($) => [$._blank, /[ \t]/],
    conflicts: ($) => [
      [$.command_list],
      [$._zero_line_address, $._invalid_misplaced_zero_address_reason],
      [$.command, $._invalid_forbidden_address_reason],
      [$.address_clause, $._single_address_clause],
      [$.address_clause, $._invalid_excess_range_reason],
    ],
    externals: ($) => tokens.map((token) => $[`_${token}`]),

    rules: {
      script: ($) => optional(alias($._root_commands, $.command_list)),
      _root_commands: ($) =>
        choice(seq($.directive, repeat(rootItem($))), repeat1(rootItem($))),
      command_list: ($) =>
        repeat1(
          choice(
            $.command,
            $.command_separator,
            $._command_layout,
            $.comment,
            problem($, "invalid_encoding"),
          ),
        ),
      command_separator: ($) => $._separator,
      _command_layout: () => token(prec(1, choice("\r", "\v", "\f"))),
      command: ($) =>
        choice(
          seq(
            optional(field("address", $.address_clause)),
            optional(field("negation", $.negation)),
            $._function,
          ),
          seq(
            optional(
              field(
                "address",
                alias($._single_address_clause, $.address_clause),
              ),
            ),
            optional(field("negation", $.negation)),
            alias($._quit_command, $.numeric_command),
            $._command_ending,
          ),
          seq(
            optional(problem($, "forbidden_address")),
            optional(field("negation", $.negation)),
            $.label_command,
          ),
          prec.dynamic(
            1,
            seq(
              choice(
                seq(
                  problem($, "forbidden_address"),
                  optional(field("negation", $.negation)),
                ),
                field("negation", $.negation),
              ),
              $.comment,
            ),
          ),
          seq(
            field("address", alias($._read_zero_clause, $.address_clause)),
            alias($._read_command, $.file_command),
            $._command_ending,
          ),
          seq(
            choice(
              seq(
                field("address", $.address_clause),
                optional(field("negation", $.negation)),
              ),
              field("negation", $.negation),
            ),
            choice(
              missing($, "missing_command"),
              problem($, "invalid_encoding"),
            ),
            $._command_ending,
          ),
        ),
      _command_ending: ($) =>
        choice($._command_end, problem($, "missing_command_separator")),
      address_clause: ($) =>
        choice(
          seq($._first_address, optional(seq($._address_tail, excess($)))),
          seq(problem($, "first_address_gap"), $._address_tail, excess($)),
          seq(
            alias($._zero_address, $.address),
            alias(",", $.address_separator),
            alias($._regex_only_address, $.address),
            excess($),
          ),
        ),
      _single_address_clause: ($) =>
        choice(
          seq(
            choice(
              $._first_address,
              alias($._misplaced_zero_address, $.address),
            ),
            excess($),
          ),
          seq(
            problem($, "first_address_gap"),
            repeat1(problem($, "excess_range")),
          ),
        ),
      _first_address: ($) =>
        choice($.address, alias($._first_relative_address, $.relative_address)),
      _first_relative_address: ($) =>
        prec.right(
          seq(
            alias(choice("+", "~"), $.address_operator),
            optional(
              choice(
                field("count", leaf($, "zero_number", "number")),
                problem($, "invalid_relative_address"),
              ),
            ),
          ),
        ),
      _read_zero_clause: ($) => alias($._zero_address, $.address),
      _misplaced_zero_address: ($) =>
        alias($._misplaced_zero_line_address, $.line_address),
      _misplaced_zero_line_address: ($) =>
        seq(problem($, "misplaced_zero_address"), zeroStep($)),
      _address_tail: ($) =>
        seq(
          alias(",", $.address_separator),
          choice($.address, $.relative_address, missing($, "missing_address")),
        ),
      address: ($) =>
        choice($.line_address, $.last_line_address, $.regex_address),
      _regex_only_address: ($) => $.regex_address,
      _zero_address: ($) => alias($._zero_line_address, $.line_address),
      _zero_line_address: ($) =>
        seq(field("first", leaf($, "zero_number", "number")), zeroStep($)),
      line_address: ($) =>
        choice(
          seq(
            field("first", leaf($, "number", "number")),
            optional(
              seq(
                alias("~", $.address_operator),
                optional(field("step", $.number)),
              ),
            ),
          ),
          seq(
            choice(
              problem($, "invalid_zero_address"),
              problem($, "invalid_zero_address", "incomplete"),
            ),
            zeroStep($),
          ),
        ),
      last_line_address: () => "$",
      relative_address: ($) =>
        prec.right(
          seq(
            alias(choice("+", "~"), $.address_operator),
            optional(field("count", $.number)),
          ),
        ),
      number: ($) => choice($._number, $._zero_number),
      negation: ($) => seq("!", repeat(problem($, "duplicate_negation"))),
      regex_address: ($) =>
        choice(
          seq(
            field("opening", leaf($, "invalid_address_prefix", "delimiter")),
            choice(
              problem($, "invalid_delimiter"),
              problem($, "invalid_encoding"),
              missing($, "missing_opening_delimiter"),
            ),
          ),
          seq(
            field("opening", leaf($, "regex_start", "delimiter")),
            choice(
              seq(
                $.regular_expression,
                field("closing", regexEnd($, "regex_end")),
                repeat($.address_modifier),
              ),
              seq(
                field("closing", regexEnd($, "regex_end")),
                repeat(problem($, "address_modifier_on_empty_regexp")),
              ),
            ),
          ),
        ),
      address_modifier: ($) => $._address_modifier,
      _function: ($) =>
        choice(
          $.branch_command,
          $.version_command,
          seq(
            choice(
              $.simple_command,
              $.block,
              $.substitute_command,
              $.translate_command,
              $.text_command,
              $.file_command,
              $.execute_command,
              $.numeric_command,
              problem($, "unknown_command"),
            ),
            $._command_ending,
          ),
        ),
      simple_command: ($) =>
        verb(
          $,
          "d",
          "D",
          "g",
          "G",
          "h",
          "H",
          "n",
          "N",
          "p",
          "P",
          "x",
          "=",
          "F",
          "z",
        ),
      numeric_command: ($) =>
        seq(verb($, "l"), optional(field("argument", $.number))),
      _quit_command: ($) =>
        seq(verb($, "q", "Q"), optional(field("argument", $.number))),
      version_command: ($) =>
        prec.right(seq(verb($, "v"), optional(field("version", $.version)))),
      version: ($) =>
        seq(
          repeat1(
            choice(
              leaf($, "version", "version_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._opaque_end,
        ),
      block: ($) =>
        seq(
          field("opening", "{"),
          optional($.command_list),
          choice(
            prec.dynamic(
              2,
              seq(
                choice(
                  seq(
                    problem($, "forbidden_address"),
                    optional(field("negation", $.negation)),
                  ),
                  field("negation", $.negation),
                ),
                field("closing", alias($._block_close, "}")),
              ),
            ),
            field(
              "closing",
              choice(
                alias($._block_close, "}"),
                problem($, "missing_closing_delimiter", "incomplete"),
              ),
            ),
          ),
        ),
      branch_command: ($) =>
        prec.right(
          seq(verb($, "b", "t", "T"), optional(field("label", $.label))),
        ),
      label_command: ($) =>
        seq(
          verb($, ":"),
          field(
            "label",
            choice(
              alias($._required_label, $.label),
              missing($, "missing_operand"),
            ),
          ),
        ),
      file_command: ($) =>
        seq(
          verb($, "r", "R", "w", "W"),
          field("file", choice($.filename, missing($, "missing_operand"))),
        ),
      _read_command: ($) =>
        seq(
          verb($, "r"),
          field("file", choice($.filename, missing($, "missing_operand"))),
        ),
      label: ($) =>
        seq(
          repeat1(
            choice(
              leaf($, "label", "label_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._opaque_end,
        ),
      _required_label: ($) =>
        seq(
          choice(
            leaf($, "label", "label_text"),
            problem($, "empty_label"),
            problem($, "invalid_encoding"),
          ),
          repeat(
            choice(
              leaf($, "label", "label_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._opaque_end,
        ),
      filename: ($) =>
        seq(
          choice(
            leaf($, "filename", "filename_text"),
            problem($, "empty_filename"),
            problem($, "invalid_encoding"),
          ),
          repeat(
            choice(
              leaf($, "filename", "filename_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._opaque_end,
        ),
      shell_command: ($) =>
        repeat1(choice(leaf($, "literal", "shell_text"), $._operand_escape)),
      execute_command: ($) =>
        seq(
          verb($, "e"),
          optional(
            seq(
              choice(
                leaf($, "shell_start", "text_introducer"),
                $._inline_shell_start,
              ),
              optional(field("command", $.shell_command)),
              $._text_end,
            ),
          ),
        ),
      text_command: ($) =>
        seq(
          verb($, "a", "c", "i"),
          choice(
            seq(
              choice(
                leaf($, "text_start", "text_introducer"),
                $._inline_text_start,
              ),
              optional($.text),
              $._text_end,
            ),
            missing($, "missing_operand"),
          ),
        ),
      text: ($) => repeat1($._operand_piece),
      substitute_command: ($) =>
        seq(
          verb($, "s"),
          choice(
            seq(
              field("opening", leaf($, "pattern_start", "delimiter")),
              choice(
                seq(
                  $.regular_expression,
                  field("separator", regexEnd($, "pattern_end")),
                  optional($.replacement),
                  field("closing", operandEnd($, "replacement_end")),
                  optional(alias($._flags_0_0, $.substitution_flags)),
                ),
                seq(
                  field("separator", regexEnd($, "pattern_end")),
                  optional($.replacement),
                  field("closing", operandEnd($, "replacement_end")),
                  optional(alias($._flags_1_0, $.substitution_flags)),
                ),
              ),
            ),
            missing($, "missing_opening_delimiter"),
            problem($, "invalid_delimiter"),
            problem($, "invalid_encoding"),
          ),
        ),
      write_flag: ($) =>
        seq(
          leaf($, "write_flag", "flag"),
          choice($.filename, missing($, "missing_operand")),
        ),
      replacement: ($) =>
        repeat1(
          choice(
            $._operand_piece,
            leaf($, "backreference", "replacement_reference"),
            leaf($, "match_reference", "matched_text_reference"),
            leaf($, "case_conversion", "case_conversion"),
          ),
        ),
      translate_command: ($) =>
        seq(
          verb($, "y"),
          choice(
            seq(
              field("opening", leaf($, "translation_start", "delimiter")),
              optional(field("source", $.translation_string)),
              field("separator", operandEnd($, "translation_middle")),
              optional(field("destination", $.translation_string)),
              field("closing", operandEnd($, "translation_end")),
            ),
            missing($, "missing_opening_delimiter"),
            problem($, "invalid_delimiter"),
            problem($, "invalid_encoding"),
          ),
        ),
      translation_string: ($) => repeat1($._operand_piece),
      _operand_piece: ($) =>
        choice(leaf($, "literal", "literal"), $._operand_escape),
      _operand_escape: ($) =>
        choice(
          leaf($, "escape", "escape"),
          leaf($, "character_escape", "character_escape"),
          leaf($, "line_continuation", "line_continuation"),
          missing($, "invalid_control_escape"),
          problem($, "missing_escape_character", "incomplete"),
          problem($, "missing_escape_character"),
          problem($, "invalid_encoding"),
        ),
      comment: ($) =>
        seq(
          leaf($, "comment", "comment_text"),
          repeat(
            choice(
              leaf($, "comment_tail", "comment_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._comment_end,
        ),
      directive: ($) =>
        seq(
          leaf($, "directive", "directive_text"),
          repeat(
            choice(
              leaf($, "comment_tail", "comment_text"),
              problem($, "invalid_encoding"),
            ),
          ),
          $._comment_end,
        ),
      regular_expression: ($) => $.alternation,
      alternation: ($) =>
        choice(
          $.regex_branch,
          seq(
            optional($.regex_branch),
            repeat1(
              seq(
                symbol($, "alternation", "regex_operator"),
                optional($.regex_branch),
              ),
            ),
          ),
        ),
      regex_branch: ($) => repeat1(choice($.repetition, $._regex_atom)),
      repetition: ($) =>
        prec.right(
          1,
          seq(
            field("expression", $._regex_atom),
            repeat1(
              field(
                "operator",
                choice(symbol($, "quantifier", "regex_operator"), $.interval),
              ),
            ),
          ),
        ),
      _regex_atom: ($) =>
        choice(
          $.regex_character,
          $.wildcard,
          $.anchor,
          $.word_boundary,
          $.regex_character_class,
          $.backreference,
          $.group,
          $.bracket_expression,
          alias($._orphan_interval, $.interval),
          problem($, "invalid_regex_operator"),
          problem($, "unmatched_group_close"),
          missing($, "invalid_control_escape"),
          problem($, "missing_escape_character", "incomplete"),
          problem($, "missing_escape_character"),
          problem($, "invalid_encoding"),
        ),
      regex_character: ($) =>
        choice(
          missing($, "invalid_interval_syntax"),
          leaf($, "regex_character", "literal"),
          leaf($, "regex_escape", "escape"),
          leaf($, "regex_character_escape", "character_escape"),
          seq(
            leaf($, "utf8_start", "character_escape"),
            repeat(leaf($, "utf8_continuation", "character_escape")),
          ),
        ),
      wildcard: ($) => symbol($, "regex_dot", "regex_operator"),
      anchor: ($) => symbol($, "regex_anchor", "regex_operator"),
      word_boundary: ($) => symbol($, "regex_boundary", "regex_operator"),
      regex_character_class: ($) =>
        symbol($, "regex_class_escape", "regex_operator"),
      backreference: ($) => symbol($, "regex_backreference", "regex_reference"),
      group: ($) =>
        seq(
          field("opening", symbol($, "group_open", "group_open")),
          optional($.regular_expression),
          field("closing", close($, "group_close", "group_close")),
        ),
      interval_count: ($) =>
        repeat1(
          choice(
            leaf($, "count", "number"),
            leaf($, "count_encoded", "character_escape"),
            leaf($, "count_escaped", "escape"),
          ),
        ),
      interval: ($) =>
        seq(
          field("opening", symbol($, "interval_open", "interval_open")),
          $._interval_body,
        ),
      _orphan_interval: ($) =>
        seq(problem($, "orphan_interval"), $._interval_body),
      _interval_issue: ($) =>
        choice(
          problem($, "invalid_interval_character"),
          missing($, "invalid_control_escape"),
          missing($, "missing_escape_character"),
          problem($, "invalid_encoding"),
        ),
      _interval_body: ($) =>
        seq(
          choice(
            $._interval_nonempty,
            problem($, "empty_interval"),
            problem($, "empty_interval", "incomplete"),
          ),
          repeat($._interval_issue),
          optional(
            seq(field("minimum", $.interval_count), repeat($._interval_issue)),
          ),
          optional(
            seq(
              symbol($, "interval_comma", "interval_separator"),
              repeat($._interval_issue),
              optional(
                seq(
                  field("maximum", $.interval_count),
                  repeat($._interval_issue),
                ),
              ),
            ),
          ),
          field("closing", close($, "interval_close", "interval_close")),
        ),
      bracket_expression: ($) =>
        seq(
          field("opening", symbol($, "bracket_open", "bracket_open")),
          optional(symbol($, "bracket_negation", "regex_operator")),
          choice(
            repeat1(choice($.range, $._bracket_atom)),
            problem($, "misplaced_character_class"),
            missing($, "missing_bracket_element"),
          ),
          field("closing", close($, "bracket_close", "bracket_close")),
        ),
      _bracket_atom: ($) =>
        choice(
          $.bracket_character,
          $.character_class,
          $.collating_symbol,
          $.equivalence_class,
          missing($, "invalid_control_escape"),
          missing($, "missing_escape_character"),
          problem($, "invalid_encoding"),
        ),
      bracket_character: ($) =>
        choice(
          leaf($, "bracket_character", "literal"),
          leaf($, "bracket_escape", "escape"),
          leaf($, "bracket_character_escape", "character_escape"),
          seq(
            leaf($, "utf8_start", "character_escape"),
            repeat(leaf($, "utf8_continuation", "character_escape")),
          ),
        ),
      range: ($) =>
        prec.right(
          1,
          seq(
            field("start", $._range_endpoint),
            symbol($, "range_dash", "range_operator"),
            field(
              "end",
              choice($._range_endpoint, missing($, "missing_bracket_element")),
            ),
            repeat(
              seq(
                problem($, "invalid_range_operator"),
                field(
                  "end",
                  choice(
                    $._range_endpoint,
                    missing($, "missing_bracket_element"),
                  ),
                ),
              ),
            ),
          ),
        ),
      _range_endpoint: ($) =>
        choice(
          $.bracket_character,
          $.collating_symbol,
          problem($, "invalid_range_endpoint"),
          missing($, "invalid_control_escape"),
          missing($, "missing_escape_character"),
          problem($, "invalid_encoding"),
        ),
      _class_payload: ($) =>
        repeat1(
          choice(
            leaf($, "term_text", "class_name_text"),
            leaf($, "term_text_escaped", "escape"),
            leaf($, "term_escape", "character_escape"),
            missing($, "invalid_control_escape"),
            missing($, "missing_escape_character"),
            problem($, "invalid_encoding"),
          ),
        ),
      collating_element: ($) =>
        repeat1(
          choice(
            leaf($, "term_text", "collating_text"),
            leaf($, "term_text_escaped", "escape"),
            leaf($, "term_escape", "character_escape"),
            missing($, "invalid_control_escape"),
            missing($, "missing_escape_character"),
            problem($, "invalid_encoding"),
          ),
        ),
      character_class: ($) =>
        seq(
          symbol($, "class_open", "class_open"),
          symbol($, "term_open_marker", "compound_marker"),
          field(
            "name",
            choice(
              seq($._class_valid, alias($._class_payload, $.class_name)),
              problem($, "unknown_character_class"),
              problem($, "unknown_character_class", "incomplete"),
              missing($, "missing_bracket_element"),
            ),
          ),
          compoundClose($, "class_close"),
        ),
      collating_symbol: ($) =>
        seq(
          symbol($, "collating_open", "collating_open"),
          symbol($, "term_open_marker", "compound_marker"),
          field(
            "element",
            choice(
              seq($._term_nonempty, $.collating_element),
              missing($, "missing_bracket_element"),
            ),
          ),
          compoundClose($, "collating_close"),
        ),
      equivalence_class: ($) =>
        seq(
          symbol($, "equivalence_open", "equivalence_open"),
          symbol($, "term_open_marker", "compound_marker"),
          field(
            "element",
            choice(
              seq($._term_nonempty, $.collating_element),
              missing($, "missing_bracket_element"),
            ),
          ),
          compoundClose($, "equivalence_close"),
        ),
      _unknown_command: () => /[^ \t\n;{}abcdeFgGhHilnNpPqQrRstTvwWxyz=:]/,
      ...flagRules(),
      ...defineIssueRules(
        definitions.map(([reason, outcome, rule]) => ({
          id: `${outcome}_${reason}`,
          reason:
            reason === "first_address_gap"
              ? "missing_address"
              : ["excess_range", "forbidden_address"].some(
                    (name) => name === reason,
                  )
                ? "excess_address"
                : [
                      "duplicate_global_flag",
                      "duplicate_print_flag",
                      "duplicate_occurrence",
                      "duplicate_zero_occurrence",
                    ].some((name) => name === reason)
                  ? "duplicate_substitution_flag"
                  : reason === "misplaced_zero_address"
                    ? "invalid_zero_address"
                    : reason === "address_modifier_on_empty_regexp"
                      ? "modifier_on_empty_regexp"
                      : reason === "empty_interval"
                        ? "missing_interval_count"
                        : reason === "orphan_interval"
                          ? "invalid_regex_operator"
                          : reason,
          outcome: `${outcome}_syntax`,
          rule,
        })),
      ),
    },
  });
}
