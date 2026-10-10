#ifndef TREE_SITTER_GSED_SCANNER_H
#define TREE_SITTER_GSED_SCANNER_H

#include "../src/tree_sitter/parser.h"
#include "tokens.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum Mode {
  NORMAL,
  ADDRESS,
  PATTERN,
  REPLACEMENT,
  SOURCE,
  DESTINATION,
  TEXT,
  SHELL,
  FLAGS,
  FILE_NAME,
  LABEL_TEXT,
  VERSION_TEXT,
  COMMENT_TEXT
};
typedef struct {
  uint32_t groups;
  int32_t delimiter;
  uint8_t mode;
  uint8_t bracket;
  uint8_t term;
  uint8_t term_stage;
  uint8_t utf8_remaining;
  uint8_t host_bracket;
  uint8_t host_term;
  bool host_escaped;
  bool host_control;
  bool host_term_closing;
  bool misplaced_class;
  bool verbatim;
  bool interval;
  bool interval_content;
  bool branch_start;
  bool atom;
  bool boundary_atom;
  bool raw_text;
} Scanner;

typedef struct {
  TSLexer lexer;
  TSLexer *input;
  bool pending;
  bool finished;
} LookaheadLexer;

static inline void lookahead_advance(TSLexer *lexer, bool skip) {
  LookaheadLexer *ahead = (LookaheadLexer *)lexer;
  if (ahead->pending) ahead->pending = false;
  else ahead->input->advance(ahead->input, skip);
  lexer->lookahead = ahead->input->lookahead;
}
static inline void lookahead_mark(TSLexer *lexer) {
  LookaheadLexer *ahead = (LookaheadLexer *)lexer;
  if (!ahead->pending && !ahead->finished) ahead->input->mark_end(ahead->input);
}
static inline bool lookahead_eof(const TSLexer *lexer) {
  const LookaheadLexer *ahead = (const LookaheadLexer *)lexer;
  return !ahead->pending && ahead->input->eof(ahead->input);
}
static inline int32_t peek_next(TSLexer *lexer) {
  LookaheadLexer *ahead = (LookaheadLexer *)lexer;
  if (!ahead->pending) {
    lexer->mark_end(lexer);
    ahead->input->advance(ahead->input, false);
    ahead->pending = true;
  }
  return ahead->input->lookahead;
}
static inline bool next_eof(TSLexer *lexer) {
  LookaheadLexer *ahead = (LookaheadLexer *)lexer;
  return ahead->input->eof(ahead->input);
}
static inline void finish_token(TSLexer *lexer) {
  lexer->mark_end(lexer);
  ((LookaheadLexer *)lexer)->finished = true;
}

typedef struct {
  int32_t value;
  bool encoded;
  bool quoted;
  bool host_escape;
  bool incomplete;
  bool pending_character;
  bool invalid_control;
  unsigned radix;
  unsigned remaining;
  unsigned prefix;
} Unit;

static inline void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}
static inline bool blank(int32_t c) {
  return c == ' ' || c == '\t';
}
static inline bool word_separator(int32_t c) {
  return blank(c) || c == ';' || c == '}' || c == '#';
}
static inline bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}
static inline bool regex_mode(const Scanner *s) {
  return s->mode == ADDRESS || s->mode == PATTERN;
}
static inline bool text_mode(const Scanner *s) {
  return s->mode == TEXT || s->mode == SHELL;
}
static inline bool decoded(int32_t c) {
  return c >= 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff);
}
static inline bool host_escapable(const Scanner *s, int32_t c) {
  return c == s->delimiter || (regex_mode(s) && c == '\n');
}
static inline bool host_boundary(TSLexer *lexer, const Scanner *s) {
  return lexer->eof(lexer) ||
    (!s->host_control &&
      !s->host_escaped &&
      (lexer->lookahead == '\n' ||
        (!text_mode(s) &&
          lexer->lookahead == s->delimiter &&
          (!regex_mode(s) || !s->host_bracket))));
}
static inline void advance_host(TSLexer *lexer, Scanner *s) {
  int32_t c = lexer->lookahead;
  if (s && regex_mode(s)) {
    if (!s->host_bracket) {
      if (s->host_control) s->host_control = false;
      else if (s->host_escaped) {
        s->host_escaped = false;
        s->host_control = c == 'c';
      } else if (c == '\\') s->host_escaped = true;
      else if (c == '[') s->host_bracket = 1;
    } else if (s->host_term) {
      if (s->host_term_closing) {
        if (c == ']') s->host_term = 0;
        s->host_term_closing = false;
      } else s->host_term_closing = c == s->host_term;
    } else if (s->host_bracket == 4 && (c == ':' || c == '.' || c == '=')) {
      s->host_bracket = 3;
      s->host_term = (uint8_t)c;
    } else if (c == ']' && s->host_bracket >= 3) s->host_bracket = 0;
    else if (c == '^' && s->host_bracket == 1) s->host_bracket = 2;
    else s->host_bracket = c == '[' ? 4 : 3;
  }
  advance(lexer);
}
static inline int hex(int32_t c) {
  if (digit(c)) return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
static inline bool skip_blanks(TSLexer *lexer) {
  bool skipped = false;
  while (blank(lexer->lookahead)) {
    lexer->advance(lexer, true);
    skipped = true;
  }
  return skipped;
}
static inline bool
emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  lexer->mark_end(lexer);
  return true;
}
static inline bool
marked(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}
static inline void reset_regex(Scanner *s) {
  s->groups = 0;
  s->bracket = 0;
  s->term = 0;
  s->term_stage = 0;
  s->utf8_remaining = 0;
  s->host_bracket = 0;
  s->host_term = 0;
  s->host_escaped = false;
  s->host_control = false;
  s->host_term_closing = false;
  s->misplaced_class = false;
  s->verbatim = false;
  s->interval = false;
  s->interval_content = false;
  s->branch_start = true;
  s->atom = false;
  s->boundary_atom = false;
  s->raw_text = false;
}
static inline void regex_element(Scanner *s) {
  if (s->interval) s->interval_content = true;
  else if (s->bracket) s->bracket = 3;
  else {
    s->atom = true;
    s->branch_start = false;
  }
}
static inline Unit
read_unit(TSLexer *lexer, bool bracket, Scanner *s, bool split) {
  Unit u = {.value = lexer->lookahead};
  bool raw_escape = !s ||
    !regex_mode(s) ||
    (!s->host_bracket && !s->host_escaped && !s->host_control);
  bool paired = s && regex_mode(s) && !s->host_bracket && !raw_escape;
  advance_host(lexer, s);
  if (u.value != '\\') return u;
  if (lexer->eof(lexer)) {
    u.incomplete = !bracket;
    u.pending_character = true;
    return u;
  }
  if (!raw_escape && s && host_boundary(lexer, s)) {
    u.incomplete = !bracket;
    return u;
  }
  int32_t c = lexer->lookahead;
  if (!decoded(c)) {
    u.quoted = !bracket;
    return u;
  }
  if (paired && c == '\\') {
    advance_host(lexer, s);
    c = lexer->lookahead;
    bool letter = c > 0 && c < 128 && strchr("afnrtvcxod", c) != NULL;
    if (lexer->eof(lexer) || !host_escapable(s, c) || (bracket && !letter)) {
      u.value = '\\';
      u.quoted = true;
      return u;
    }
    if (!letter) {
      advance_host(lexer, s);
      u.value = c;
      u.quoted = true;
      return u;
    }
  }
  bool delimiter = s &&
    raw_escape &&
    !text_mode(s) &&
    host_escapable(s, c) &&
    !s->host_bracket;
  if (
    bracket &&
    !delimiter &&
    c != '\\' &&
    (c == 0 || c > 127 || strchr("afnrtvcxod", c) == NULL)
  )
    return u;
  if (
    split &&
    !delimiter &&
    c != '\n' &&
    (c == 0 || c > 127 || strchr("afnrtvcxod", c) == NULL)
  ) {
    s->verbatim = true;
    return u;
  }
  advance_host(lexer, s);
  u.value = c;
  if (delimiter) {
    u.host_escape = true;
    return u;
  }
  u.encoded = true;
  switch (c) {
    case 'a':
      u.value = 7;
      break;
    case 'f':
      u.value = 12;
      break;
    case 'n':
      u.value = 10;
      break;
    case 'r':
      u.value = 13;
      break;
    case 't':
      u.value = 9;
      break;
    case 'v':
      u.value = 11;
      break;
    case 'c':
      if (lexer->eof(lexer) || (s && host_boundary(lexer, s))) {
        u.incomplete = s && regex_mode(s);
        u.pending_character = lexer->eof(lexer);
        break;
      }
      if (!decoded(lexer->lookahead)) break;
      c = lexer->lookahead;
      advance_host(lexer, s);
      if (c == '\\' && s && text_mode(s)) {
        if (!lexer->eof(lexer)) {
          u.invalid_control =
            decoded(lexer->lookahead) && lexer->lookahead != '\\';
          if (lexer->lookahead == '\\' || lexer->lookahead == '\n')
            advance_host(lexer, s);
        }
      } else if (c == '\\' && s) {
        if (
          (!regex_mode(s) || s->host_escaped) &&
          !lexer->eof(lexer) &&
          (lexer->lookahead == s->delimiter || lexer->lookahead == '\n')
        ) {
          u.invalid_control = !regex_mode(s) && lexer->lookahead == '&';
          c = lexer->lookahead;
          advance_host(lexer, s);
        } else if (lexer->lookahead == '\\' && !lexer->eof(lexer)) {
          advance_host(lexer, s);
          if (
            regex_mode(s) &&
            s->host_escaped &&
            host_escapable(s, lexer->lookahead) &&
            !lexer->eof(lexer)
          ) {
            advance_host(lexer, s);
            u.invalid_control = true;
          }
        } else if (lexer->eof(lexer) || decoded(lexer->lookahead)) {
          u.invalid_control = true;
          u.incomplete = lexer->eof(lexer);
        }
      }
      if (c >= 'a' && c <= 'z') c -= 32;
      u.value = c ^ 64;
      break;
    case 'x':
    case 'o':
    case 'd': {
      unsigned radix = c == 'x' ? 16 : c == 'o' ? 8 : 10;
      unsigned limit = c == 'x' ? 2 : 3;
      unsigned value = 0, count = 0;
      while (count < limit && !(s && host_boundary(lexer, s))) {
        bool escaped = s &&
          !text_mode(s) &&
          !s->host_bracket &&
          !s->host_escaped &&
          !s->host_control &&
          lexer->lookahead == '\\' &&
          hex(s->delimiter) >= 0 &&
          (unsigned)hex(s->delimiter) < radix &&
          peek_next(lexer) == s->delimiter;
        int d = hex(escaped ? s->delimiter : lexer->lookahead);
        if (d < 0 || (unsigned)d >= radix) break;
        if (escaped) advance_host(lexer, s);
        value = value * radix + (unsigned)d;
        advance_host(lexer, s);
        count++;
      }
      if (lexer->eof(lexer) && count < limit) {
        u.radix = radix;
        u.remaining = limit - count;
        u.prefix = value;
      }
      if (count) u.value = (int32_t)(value & 255);
      else {
        u.encoded = false;
        u.quoted = true;
      }
      break;
    }
    default:
      u.encoded = false;
      u.quoted = true;
      break;
  }
  return u;
}
static inline Unit unit(TSLexer *lexer, bool bracket, Scanner *s) {
  return read_unit(lexer, bracket, s, false);
}
static inline bool in_list(const Scanner *s) {
  return s && regex_mode(s) && s->bracket == 3 && !s->term;
}
static inline void peek_range(TSLexer *lexer, const Scanner *s) {
  Scanner ahead = *s;
  if (host_boundary(lexer, &ahead)) {
    if (!lexer->eof(lexer)) advance(lexer);
  } else if (
    unit(lexer, true, &ahead).value == '-' && !host_boundary(lexer, &ahead)
  )
    unit(lexer, true, &ahead);
}
static inline bool peeked(
  TSLexer *lexer,
  const Scanner *s,
  const bool *valid,
  enum TokenType token
) {
  if (!valid[token]) return false;
  finish_token(lexer);
  if (in_list(s)) peek_range(lexer, s);
  else if (!lexer->eof(lexer)) advance(lexer);
  lexer->result_symbol = token;
  return true;
}
static inline bool element(
  TSLexer *lexer,
  const Scanner *s,
  const bool *valid,
  enum TokenType token
) {
  return in_list(s) ? peeked(lexer, s, valid, token)
                    : emit(lexer, valid, token);
}
static inline bool
invalid_encoding(TSLexer *lexer, Scanner *s, const bool *valid) {
  do {
    advance_host(lexer, s);
  } while (!lexer->eof(lexer) && !decoded(lexer->lookahead));
  return peeked(lexer, s, valid, INVALID_ENCODING);
}
static inline Unit regex_piece(TSLexer *lexer, Scanner *s) {
  if (s->verbatim) {
    Unit u = {.value = lexer->lookahead};
    s->verbatim = false;
    advance_host(lexer, s);
    return u;
  }
  return read_unit(lexer, s->bracket != 0, s, !s->bracket);
}
static inline Unit regex_unit(TSLexer *lexer, Scanner *s) {
  Unit u = regex_piece(lexer, s);
  if (u.value == '\\' && !u.quoted && !u.host_escape && !s->bracket) {
    if (host_boundary(lexer, s) && !s->verbatim) u.incomplete = true;
    else if (!decoded(lexer->lookahead)) u.quoted = true;
    else {
      Unit next = regex_piece(lexer, s);
      u.value = next.value;
      u.encoded = u.encoded || next.encoded;
      u.quoted = true;
      u.incomplete = next.incomplete;
      u.invalid_control = next.invalid_control;
    }
  }
  return u;
}
static inline bool
control_issue(TSLexer *lexer, const Scanner *s, const bool *valid, Unit u) {
  return peeked(
    lexer,
    s,
    valid,
    u.incomplete ? INCOMPLETE_CONTROL_ESCAPE : INVALID_CONTROL_ESCAPE
  );
}
static inline enum TokenType
variant(Unit u, enum TokenType plain, enum TokenType encoded) {
  return u.encoded ? encoded : u.host_escape ? escaped_symbol(plain) : plain;
}
static inline enum TokenType bracket_character(Unit u) {
  return u.encoded                ? BRACKET_CHARACTER_ESCAPE
    : (u.quoted || u.host_escape) ? BRACKET_ESCAPE
                                  : BRACKET_CHARACTER;
}
static inline bool encoded_symbol(
  TSLexer *lexer,
  const bool *valid,
  Unit u,
  enum TokenType plain,
  enum TokenType encoded
) {
  return emit(lexer, valid, variant(u, plain, encoded));
}
static inline bool boundary(TSLexer *lexer, const Scanner *s) {
  return host_boundary(lexer, s);
}
static inline bool missing(TSLexer *lexer, Scanner *s, const bool *valid) {
  enum TokenType token = lexer->eof(lexer) ? END_OF_INPUT : BOUNDARY;
  if (!valid[token]) return false;
  if (
    !lexer->eof(lexer) &&
    lexer->lookahead != '\n' &&
    lexer->lookahead != ';' &&
    lexer->lookahead != '}' &&
    lexer->lookahead != '#' &&
    !(regex_mode(s) && lexer->lookahead == s->delimiter)
  )
    return false;
  if (regex_mode(s)) {
    if (s->term) {
      s->term = 0;
      s->term_stage = 0;
      s->misplaced_class = false;
    } else if (s->interval) s->interval = false;
    else if (s->bracket) s->bracket = 0;
    else if (s->groups) s->groups--;
  }
  return regex_mode(s) ? emit(lexer, valid, token)
                       : marked(lexer, valid, token);
}
static inline bool misplaced_class(TSLexer *lexer, Scanner state) {
  bool name = false;
  int32_t last = 0;
  while (!host_boundary(lexer, &state)) {
    Unit u = unit(lexer, true, &state);
    if (
      !decoded(u.value) ||
      u.incomplete ||
      u.value == '-' ||
      (last == '[' && (u.value == ':' || u.value == '.' || u.value == '='))
    )
      return false;
    if (u.value == ']') return name && last == ':';
    name = name || (last != 0 && last != ':');
    last = u.value;
  }
  return false;
}
static inline bool completes_character(Unit u, unsigned character) {
  if (u.pending_character) return true;
  unsigned low = u.prefix, width = 1;
  for (unsigned i = 0; i < u.remaining; i++) {
    low *= u.radix;
    width *= u.radix;
    if (((character - low) & 255) < width) return true;
  }
  return false;
}
static inline enum TokenType
classify_class(TSLexer *lexer, Scanner state, uint8_t marker) {
  char name[32] = {0};
  size_t length = 0;
  bool ascii = true, invalid = false, terminated = false, at_eof = false;
  const char *names[] = {
    "alnum",
    "alpha",
    "blank",
    "cntrl",
    "digit",
    "graph",
    "lower",
    "print",
    "punct",
    "space",
    "upper",
    "xdigit"
  };
  bool extendable = false;
  Unit current = unit(lexer, true, &state);
  for (;;) {
    if (
      ascii && lexer->eof(lexer) && (current.pending_character || current.radix)
    ) {
      for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++)
        if (
          strncmp(name, names[i], length) == 0 &&
          names[i][length] &&
          completes_character(current, (unsigned char)names[i][length])
        )
          extendable = true;
    }
    if (!decoded(current.value) || current.invalid_control) invalid = true;
    if (current.value == marker) {
      if (host_boundary(lexer, &state)) {
        terminated = true;
        at_eof = lexer->eof(lexer);
        break;
      }
      Unit next = unit(lexer, true, &state);
      if (next.value == ']') {
        terminated = true;
        break;
      }
      if (length + 1 < sizeof(name)) name[length++] = (char)marker;
      else ascii = false;
      current = next;
      continue;
    }
    if (current.value > 0 && current.value < 128 && length + 1 < sizeof(name))
      name[length++] = (char)current.value;
    else ascii = false;
    if (host_boundary(lexer, &state)) break;
    current = unit(lexer, true, &state);
  }
  if (length == 0 && ascii && terminated && !invalid)
    return at_eof ? END_OF_INPUT : BOUNDARY;
  if (invalid) return CLASS_VALID;
  bool prefix = false;
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
    if (ascii && strcmp(name, names[i]) == 0) return CLASS_VALID;
    if (ascii && strncmp(name, names[i], length) == 0) prefix = true;
  }
  return (extendable || (prefix && !terminated && lexer->eof(lexer)))
    ? CLASS_INCOMPLETE
    : CLASS_INVALID;
}
static inline bool scan_term(TSLexer *lexer, Scanner *s, const bool *valid) {
  if (s->term_stage == 2) {
    finish_token(lexer);
    enum TokenType token;
    Scanner ahead = *s;
    if (s->term == ':') token = classify_class(lexer, ahead, s->term);
    else {
      Unit first = unit(lexer, true, &ahead);
      token = TERM_NONEMPTY;
      if (first.value == s->term) {
        if (lexer->eof(lexer)) token = END_OF_INPUT;
        else if (
          host_boundary(lexer, &ahead) || unit(lexer, true, &ahead).value == ']'
        )
          token = BOUNDARY;
      }
    }
    s->term_stage = 3;
    return marked(lexer, valid, token);
  }
  if (!decoded(lexer->lookahead))
    return invalid_encoding(lexer, regex_mode(s) ? s : NULL, valid);
  lexer->mark_end(lexer);
  Unit u = unit(lexer, true, s);
  if (s->term_stage == 1) {
    s->term_stage = 2;
    return encoded_symbol(
      lexer,
      valid,
      u,
      TERM_OPEN_MARKER,
      TERM_OPEN_MARKER_ENCODED
    );
  }
  if (s->term_stage == 4) {
    s->term = 0;
    s->term_stage = 0;
    return element(lexer, s, valid, variant(u, TERM_CLOSE, TERM_CLOSE_ENCODED));
  }
  if (u.invalid_control) return control_issue(lexer, s, valid, u);
  if (u.incomplete)
    return emit(
      lexer,
      valid,
      lexer->eof(lexer) ? INCOMPLETE_ESCAPE : INVALID_ESCAPE
    );
  if (u.value == s->term) {
    finish_token(lexer);
    bool closing = host_boundary(lexer, s);
    if (!closing) {
      Scanner ahead = *s;
      Unit next = unit(lexer, true, &ahead);
      closing = next.value == ']';
    }
    if (closing) {
      if (s->misplaced_class) {
        s->term = 0;
        s->term_stage = 0;
        s->misplaced_class = false;
      } else s->term_stage = 4;
      return marked(
        lexer,
        valid,
        variant(u, TERM_CLOSE_MARKER, TERM_CLOSE_MARKER_ENCODED)
      );
    }
    return marked(lexer, valid, variant(u, TERM_TEXT, TERM_ESCAPE));
  }
  if (u.encoded || u.host_escape || u.quoted)
    return emit(lexer, valid, u.encoded ? TERM_ESCAPE : TERM_TEXT_ESCAPED);
  while (
    !host_boundary(lexer, s) &&
    decoded(lexer->lookahead) &&
    lexer->lookahead != '\\' &&
    lexer->lookahead != s->term
  )
    advance_host(lexer, s);
  return emit(lexer, valid, TERM_TEXT);
}
static inline enum TokenType literal_interval(TSLexer *lexer, Scanner state) {
  bool count = false, comma = false;
  while (!host_boundary(lexer, &state)) {
    Unit u = regex_unit(lexer, &state);
    if (!decoded(u.value) || u.invalid_control) return REGEX_ESCAPE;
    if (digit(u.value) && !u.quoted) {
      count = true;
      continue;
    }
    if (u.value == ',' && !u.quoted && !comma) {
      comma = true;
      continue;
    }
    if (u.value == '}' && u.quoted && (count || comma)) return REGEX_ESCAPE;
    if (lexer->eof(lexer)) {
      if (
        u.incomplete ||
        u.pending_character ||
        (!comma && completes_character(u, ','))
      )
        return INCOMPLETE_INTERVAL_SYNTAX;
      for (unsigned c = '0'; c <= '9'; c++)
        if (completes_character(u, c)) return INCOMPLETE_INTERVAL_SYNTAX;
    }
    return INVALID_INTERVAL_SYNTAX;
  }
  return lexer->eof(lexer) ? INCOMPLETE_INTERVAL_SYNTAX
                           : INVALID_INTERVAL_SYNTAX;
}
static inline bool scan_regex(TSLexer *lexer, Scanner *s, const bool *valid) {
  if (s->interval && !s->interval_content) {
    finish_token(lexer);
    enum TokenType token = INTERVAL_NONEMPTY;
    if (boundary(lexer, s))
      token = lexer->eof(lexer) ? INTERVAL_EMPTY_EOF : INTERVAL_EMPTY;
    else {
      Scanner ahead = *s;
      Unit u = regex_unit(lexer, &ahead);
      if (u.value == '}' && (GSED_EXTENDED != u.quoted)) token = INTERVAL_EMPTY;
    }
    s->interval_content = true;
    return marked(lexer, valid, token);
  }
  if (boundary(lexer, s)) {
    if (
      (s->groups || s->bracket || s->interval || s->term) &&
      missing(lexer, s, valid)
    )
      return true;
    if (lexer->eof(lexer) || lexer->lookahead == '\n') {
      enum TokenType token =
        lexer->eof(lexer) ? UNTERMINATED_REGEX_EOF : UNTERMINATED_REGEX_LINE;
      if (!valid[token]) return missing(lexer, s, valid);
      s->mode = s->mode == PATTERN ? REPLACEMENT : NORMAL;
      reset_regex(s);
      return emit(lexer, valid, token);
    }
    enum TokenType token = s->mode == PATTERN ? PATTERN_END : REGEX_END;
    if (!valid[token]) return missing(lexer, s, valid);
    s->mode = s->mode == PATTERN ? REPLACEMENT : NORMAL;
    advance_host(lexer, s);
    reset_regex(s);
    return emit(lexer, valid, token);
  }
  if (s->term) return scan_term(lexer, s, valid);
  if (!decoded(lexer->lookahead)) {
    regex_element(s);
    return invalid_encoding(lexer, s, valid);
  }
  lexer->mark_end(lexer);
  Unit u = regex_unit(lexer, s);
  int32_t c = u.value;
  bool boundary_atom = s->boundary_atom;
  s->boundary_atom = false;
  if (u.invalid_control) {
    regex_element(s);
    return control_issue(lexer, s, valid, u);
  }
  if (u.incomplete) {
    regex_element(s);
    return element(
      lexer,
      s,
      valid,
      lexer->eof(lexer) ? INCOMPLETE_ESCAPE : INVALID_ESCAPE
    );
  }
  if (!s->term && !s->interval) {
    if (s->utf8_remaining && u.encoded && c >= 0x80 && c <= 0xbf) {
      s->utf8_remaining--;
      return element(lexer, s, valid, UTF8_CONTINUATION);
    }
    s->utf8_remaining = 0;
    if (u.encoded && c >= 0xc2 && c <= 0xf4) {
      uint8_t count = c < 0xe0 ? 1 : c < 0xf0 ? 2 : 3;
      finish_token(lexer);
      bool complete = true;
      for (uint8_t i = 0; i < count; i++) {
        if (boundary(lexer, s)) {
          complete = false;
          break;
        }
        Scanner ahead = *s;
        Unit next = unit(lexer, false, &ahead);
        int32_t low = i == 0 && c == 0xe0 ? 0xa0
          : i == 0 && c == 0xf0           ? 0x90
                                          : 0x80;
        int32_t high = i == 0 && c == 0xed ? 0x9f
          : i == 0 && c == 0xf4            ? 0x8f
                                           : 0xbf;
        if (
          !next.encoded ||
          next.incomplete ||
          next.invalid_control ||
          next.value < low ||
          next.value > high
        ) {
          if (
            s->bracket &&
            i == 0 &&
            next.value == '-' &&
            !boundary(lexer, &ahead)
          )
            unit(lexer, true, &ahead);
          complete = false;
          break;
        }
      }
      s->utf8_remaining = complete ? count : 0;
      if (s->bracket) s->bracket = 3;
      s->atom = true;
      s->branch_start = false;
      return marked(
        lexer,
        valid,
        complete       ? UTF8_START
          : s->bracket ? BRACKET_CHARACTER_ESCAPE
                       : REGEX_CHARACTER_ESCAPE
      );
    }
  }
  if (s->interval) {
    s->interval_content = true;
    if (c == '}' && (GSED_EXTENDED != u.quoted)) {
      s->interval = false;
      return encoded_symbol(
        lexer,
        valid,
        u,
        INTERVAL_CLOSE,
        INTERVAL_CLOSE_ENCODED
      );
    }
    if (
      digit(c) &&
      !u.quoted &&
      (valid[COUNT] || valid[COUNT_ENCODED] || valid[COUNT_ESCAPED])
    ) {
      if (!u.encoded && !u.host_escape)
        while (digit(lexer->lookahead) && lexer->lookahead != s->delimiter)
          advance_host(lexer, s);
      return emit(
        lexer,
        valid,
        u.encoded         ? COUNT_ENCODED
          : u.host_escape ? COUNT_ESCAPED
                          : COUNT
      );
    }
    if (c == ',' && !u.quoted && valid[INTERVAL_COMMA])
      return encoded_symbol(
        lexer,
        valid,
        u,
        INTERVAL_COMMA,
        INTERVAL_COMMA_ENCODED
      );
    if (u.encoded || u.quoted || u.host_escape)
      return emit(
        lexer,
        valid,
        u.encoded ? INVALID_INTERVAL_CHARACTER_ENCODED
                  : INVALID_INTERVAL_CHARACTER_ESCAPED
      );
    while (
      !boundary(lexer, s) &&
      decoded(lexer->lookahead) &&
      lexer->lookahead != ',' &&
      lexer->lookahead != '}' &&
      lexer->lookahead != '\\'
    )
      advance_host(lexer, s);
    return emit(lexer, valid, INVALID_INTERVAL_CHARACTER);
  }
  if (s->bracket) {
    if (c == ']' && s->bracket == 3 && !u.quoted) {
      s->bracket = 0;
      s->atom = true;
      return encoded_symbol(
        lexer,
        valid,
        u,
        BRACKET_CLOSE,
        BRACKET_CLOSE_ENCODED
      );
    }
    if (c == '^' && s->bracket == 1 && !u.quoted) {
      s->bracket = 2;
      return encoded_symbol(
        lexer,
        valid,
        u,
        BRACKET_NEGATION,
        BRACKET_NEGATION_ENCODED
      );
    }
    uint8_t previous = s->bracket;
    s->bracket = 3;
    if (c == ':' && previous < 3) {
      finish_token(lexer);
      if (misplaced_class(lexer, *s)) {
        s->term = ':';
        s->term_stage = 3;
        s->misplaced_class = true;
        return marked(
          lexer,
          valid,
          variant(u, MISPLACED_CLASS_START, MISPLACED_CLASS_START_ENCODED)
        );
      }
      return marked(lexer, valid, bracket_character(u));
    }
    if (c == '[' && !u.quoted && !boundary(lexer, s)) {
      finish_token(lexer);
      Scanner ahead = *s;
      Unit marker = unit(lexer, true, &ahead);
      if (marker.value == ':' || marker.value == '.' || marker.value == '=') {
        s->term = (uint8_t)marker.value;
        s->term_stage = 1;
        enum TokenType token = marker.value == ':'
          ? variant(u, CLASS_OPEN, CLASS_OPEN_ENCODED)
          : marker.value == '.'
          ? variant(u, COLLATING_OPEN, COLLATING_OPEN_ENCODED)
          : variant(u, EQUIVALENCE_OPEN, EQUIVALENCE_OPEN_ENCODED);
        return marked(lexer, valid, token);
      }
      if (marker.value == '-' && !boundary(lexer, &ahead))
        unit(lexer, true, &ahead);
      return marked(lexer, valid, bracket_character(u));
    }
    if (
      c == '-' &&
      previous == 3 &&
      (valid[RANGE_DASH] || valid[INVALID_RANGE_OPERATOR])
    ) {
      finish_token(lexer);
      bool closing = boundary(lexer, s);
      if (!closing) {
        Scanner ahead = *s;
        Unit next = unit(lexer, true, &ahead);
        closing = next.value == ']' && !next.quoted;
      }
      enum TokenType token = valid[RANGE_DASH]
        ? variant(u, RANGE_DASH, RANGE_DASH_ENCODED)
        : variant(u, INVALID_RANGE_OPERATOR, INVALID_RANGE_OPERATOR_ENCODED);
      return marked(lexer, valid, closing ? bracket_character(u) : token);
    }
    return element(lexer, s, valid, bracket_character(u));
  }
  if (c == '[' && !u.quoted) {
    s->bracket = 1;
    s->branch_start = false;
    return encoded_symbol(lexer, valid, u, BRACKET_OPEN, BRACKET_OPEN_ENCODED);
  }
  if (c == '(' && (GSED_EXTENDED != u.quoted)) {
    s->groups++;
    s->atom = false;
    s->branch_start = true;
    return encoded_symbol(lexer, valid, u, GROUP_OPEN, GROUP_OPEN_ENCODED);
  }
  if (c == ')' && (GSED_EXTENDED != u.quoted)) {
    if (!s->groups)
      return encoded_symbol(
        lexer,
        valid,
        u,
        UNMATCHED_GROUP_CLOSE,
        UNMATCHED_GROUP_CLOSE_ENCODED
      );
    s->groups--;
    s->atom = true;
    s->branch_start = false;
    return encoded_symbol(lexer, valid, u, GROUP_CLOSE, GROUP_CLOSE_ENCODED);
  }
  if (c == '|' && (GSED_EXTENDED != u.quoted)) {
    s->atom = false;
    s->branch_start = true;
    return encoded_symbol(lexer, valid, u, ALTERNATION, ALTERNATION_ENCODED);
  }
  if (
    (c == '*' && !u.quoted) ||
    ((c == '+' || c == '?') && (GSED_EXTENDED != u.quoted))
  ) {
    if (s->atom)
      return encoded_symbol(lexer, valid, u, QUANTIFIER, QUANTIFIER_ENCODED);
    if (GSED_EXTENDED)
      return encoded_symbol(
        lexer,
        valid,
        u,
        INVALID_REGEX_OPERATOR,
        INVALID_REGEX_OPERATOR_ENCODED
      );
  }
  if (c == '{' && (GSED_EXTENDED != u.quoted)) {
    if (!s->atom && !GSED_EXTENDED) {
      s->atom = true;
      s->branch_start = false;
      if (boundary_atom) {
        finish_token(lexer);
        enum TokenType token = literal_interval(lexer, *s);
        if (token != REGEX_ESCAPE)
          return marked(
            lexer,
            valid,
            variant(
              u,
              token,
              token == INVALID_INTERVAL_SYNTAX
                ? INVALID_INTERVAL_SYNTAX_ENCODED
                : INCOMPLETE_INTERVAL_SYNTAX_ENCODED
            )
          );
        return marked(
          lexer,
          valid,
          u.encoded ? REGEX_CHARACTER_ESCAPE : REGEX_ESCAPE
        );
      }
      return emit(
        lexer,
        valid,
        u.encoded ? REGEX_CHARACTER_ESCAPE : REGEX_ESCAPE
      );
    }
    s->interval = true;
    s->interval_content = false;
    if (!s->atom)
      return encoded_symbol(
        lexer,
        valid,
        u,
        ORPHAN_INTERVAL_OPEN,
        ORPHAN_INTERVAL_OPEN_ENCODED
      );
    return encoded_symbol(
      lexer,
      valid,
      u,
      INTERVAL_OPEN,
      INTERVAL_OPEN_ENCODED
    );
  }
  if (u.quoted && c >= '1' && c <= '9') {
    s->atom = true;
    s->branch_start = false;
    return encoded_symbol(
      lexer,
      valid,
      u,
      REGEX_BACKREFERENCE,
      REGEX_BACKREFERENCE_ENCODED
    );
  }
  if (
    u.quoted &&
    (c == 'b' || c == 'B' || c == '<' || c == '>' || c == '`' || c == '\'')
  ) {
    s->boundary_atom = s->atom || boundary_atom;
    s->atom = false;
    s->branch_start = false;
    return encoded_symbol(
      lexer,
      valid,
      u,
      REGEX_BOUNDARY,
      REGEX_BOUNDARY_ENCODED
    );
  }
  if (u.quoted && (c == 'w' || c == 'W' || c == 's' || c == 'S')) {
    s->atom = true;
    s->branch_start = false;
    return encoded_symbol(
      lexer,
      valid,
      u,
      REGEX_CLASS_ESCAPE,
      REGEX_CLASS_ESCAPE_ENCODED
    );
  }
  if (!u.quoted && c == '.') {
    s->atom = true;
    s->branch_start = false;
    return encoded_symbol(lexer, valid, u, REGEX_DOT, REGEX_DOT_ENCODED);
  }
  if (!u.quoted && c == '^' && (GSED_EXTENDED || s->branch_start)) {
    s->atom = false;
    s->branch_start = false;
    return encoded_symbol(lexer, valid, u, REGEX_ANCHOR, REGEX_ANCHOR_ENCODED);
  }
  if (!u.quoted && c == '$') {
    finish_token(lexer);
    bool end = boundary(lexer, s);
    if (!end && !lexer->eof(lexer)) {
      Scanner ahead = *s;
      Unit next = regex_unit(lexer, &ahead);
      end = (next.value == ')' || next.value == '|') &&
        (GSED_EXTENDED != next.quoted);
    }
    if (GSED_EXTENDED || end) {
      s->atom = false;
      s->branch_start = false;
      return marked(
        lexer,
        valid,
        u.encoded         ? REGEX_ANCHOR_ENCODED
          : u.host_escape ? REGEX_ANCHOR_ESCAPED
                          : REGEX_ANCHOR
      );
    }
    s->atom = true;
    s->branch_start = false;
    return marked(
      lexer,
      valid,
      u.encoded         ? REGEX_CHARACTER_ESCAPE
        : u.host_escape ? REGEX_ESCAPE
                        : REGEX_CHARACTER
    );
  }
  s->atom = true;
  s->branch_start = false;
  return emit(
    lexer,
    valid,
    u.encoded                       ? REGEX_CHARACTER_ESCAPE
      : (u.quoted || u.host_escape) ? REGEX_ESCAPE
                                    : REGEX_CHARACTER
  );
}
static inline bool raw_text(TSLexer *lexer, Scanner *s, bool leadin) {
  bool escaped = false;
  bool prefix = leadin;
  s->verbatim = false;
  if (leadin && !lexer->eof(lexer)) advance(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (prefix && c != '\\') {
      s->verbatim = c == '\n';
      prefix = false;
    }
    if (c == '\n' && !escaped) return false;
    escaped = c == '\\' && !escaped;
    advance(lexer);
  }
  if (escaped && leadin) s->verbatim = true;
  return escaped;
}
static inline bool
scan_raw_text(TSLexer *lexer, Scanner *s, const bool *valid) {
  bool consumed = false;
  if (s->verbatim) {
    s->verbatim = false;
    advance(lexer);
    consumed = true;
  }
  while (
    !lexer->eof(lexer) && lexer->lookahead != '\n' && decoded(lexer->lookahead)
  ) {
    if (lexer->lookahead == '\\') {
      int32_t next = peek_next(lexer);
      if (next == '\n' || next_eof(lexer)) {
        if (consumed) break;
        advance(lexer);
        if (lexer->eof(lexer)) return emit(lexer, valid, ESCAPE);
        advance(lexer);
        return emit(lexer, valid, LINE_CONTINUATION);
      }
      advance(lexer);
      if (!decoded(lexer->lookahead)) break;
    }
    advance(lexer);
    consumed = true;
  }
  return emit(lexer, valid, LITERAL);
}
static inline bool scan_operand(TSLexer *lexer, Scanner *s, const bool *valid) {
  if (text_mode(s) && (lexer->eof(lexer) || lexer->lookahead == '\n')) {
    s->mode = NORMAL;
    return emit(lexer, valid, TEXT_END);
  }
  if (s->verbatim && !s->raw_text) {
    s->verbatim = false;
    advance(lexer);
    return emit(lexer, valid, ESCAPE);
  }
  if (lexer->eof(lexer) || lexer->lookahead == '\n') {
    enum TokenType token =
      lexer->eof(lexer) ? UNTERMINATED_OPERAND_EOF : UNTERMINATED_OPERAND_LINE;
    if (!valid[token]) return false;
    s->mode = s->mode == SOURCE ? DESTINATION : NORMAL;
    return emit(lexer, valid, token);
  }
  if (!text_mode(s) && lexer->lookahead == s->delimiter) {
    enum TokenType token = s->mode == REPLACEMENT ? REPLACEMENT_END
      : s->mode == SOURCE                         ? TRANSLATION_MIDDLE
                                                  : TRANSLATION_END;
    advance(lexer);
    s->mode = s->mode == SOURCE ? DESTINATION
      : s->mode == REPLACEMENT  ? FLAGS
                                : NORMAL;
    return emit(lexer, valid, token);
  }
  if (!decoded(lexer->lookahead))
    return invalid_encoding(lexer, regex_mode(s) ? s : NULL, valid);
  if (text_mode(s) && s->raw_text) return scan_raw_text(lexer, s, valid);
  int32_t raw = lexer->lookahead;
  Unit u = unit(lexer, false, s);
  if (u.invalid_control) return control_issue(lexer, s, valid, u);
  if (u.incomplete)
    return emit(lexer, valid, text_mode(s) ? ESCAPE : INCOMPLETE_ESCAPE);
  if (raw == '\\' && u.value == '\n' && !u.encoded)
    return emit(lexer, valid, LINE_CONTINUATION);
  if (s->mode == REPLACEMENT) {
    if (raw == '&') return emit(lexer, valid, MATCH_REFERENCE);
    if (u.quoted && digit(u.value)) return emit(lexer, valid, BACKREFERENCE);
    if (
      u.quoted &&
      (u.value == 'L' ||
        u.value == 'l' ||
        u.value == 'U' ||
        u.value == 'u' ||
        u.value == 'E')
    )
      return emit(lexer, valid, CASE_CONVERSION);
  }
  if (raw == '\\')
    return emit(lexer, valid, u.encoded ? CHARACTER_ESCAPE : ESCAPE);
  while (
    !lexer->eof(lexer) &&
    lexer->lookahead != '\n' &&
    lexer->lookahead != '\\' &&
    decoded(lexer->lookahead) &&
    (text_mode(s) || lexer->lookahead != s->delimiter) &&
    (s->mode != REPLACEMENT || lexer->lookahead != '&')
  )
    advance(lexer);
  return emit(lexer, valid, LITERAL);
}
static inline bool scan_opaque(TSLexer *lexer, Scanner *s, const bool *valid) {
  bool word = s->mode == LABEL_TEXT || s->mode == VERSION_TEXT;
  bool comment = s->mode == COMMENT_TEXT;
  if (
    lexer->eof(lexer) ||
    lexer->lookahead == '\n' ||
    (word && word_separator(lexer->lookahead))
  ) {
    s->mode = NORMAL;
    return emit(lexer, valid, comment ? COMMENT_END : OPAQUE_END);
  }
  if (!decoded(lexer->lookahead))
    return invalid_encoding(lexer, regex_mode(s) ? s : NULL, valid);
  enum TokenType token = s->mode == LABEL_TEXT ? LABEL
    : s->mode == VERSION_TEXT                  ? VERSION
    : comment                                  ? COMMENT_TAIL
                                               : FILENAME;
  bool consumed = false;
  while (
    !lexer->eof(lexer) && lexer->lookahead != '\n' && decoded(lexer->lookahead)
  ) {
    if (word && word_separator(lexer->lookahead)) break;
    advance(lexer);
    lexer->mark_end(lexer);
    consumed = true;
  }
  return consumed && marked(lexer, valid, token);
}
static inline enum TokenType zero_address(TSLexer *lexer, bool first) {
  while (blank(lexer->lookahead)) advance(lexer);
  if (lexer->lookahead == '~') {
    advance(lexer);
    while (blank(lexer->lookahead)) advance(lexer);
    while (lexer->lookahead == '0') advance(lexer);
    if (digit(lexer->lookahead)) return NUMBER;
    while (blank(lexer->lookahead)) advance(lexer);
  }
  if (first && lexer->lookahead == ',') {
    advance(lexer);
    while (blank(lexer->lookahead)) advance(lexer);
    if (lexer->lookahead == '/' || lexer->lookahead == '\\') return ZERO_NUMBER;
  } else if (first && lexer->lookahead == 'r') return ZERO_NUMBER;
  return lexer->eof(lexer) ? PENDING_ZERO : INVALID_ZERO;
}
static inline bool scan_layout(TSLexer *lexer, Scanner *s, const bool *valid) {
  lexer->mark_end(lexer);
  while (blank(lexer->lookahead)) advance(lexer);
  int32_t c = lexer->lookahead;
  bool end = lexer->eof(lexer) || c == '\n';
  bool command_end = end || c == ';' || c == '}' || c == '#';
  bool operand = (valid[FILENAME] || valid[SHELL_START]) && !end;
  operand =
    operand || ((valid[LABEL] || valid[VERSION]) && !end && !word_separator(c));
  bool content = operand ||
    ((valid[TEXT_START] || valid[INLINE_TEXT_START]) && !lexer->eof(lexer)) ||
    (valid[FIRST_ADDRESS_GAP] && c == ',') ||
    (valid[NUMBER] && digit(c)) ||
    (valid[ZERO_NUMBER] && digit(c)) ||
    (valid[REGEX_START] && (c == '/' || c == '\\')) ||
    (valid[SEPARATOR] && (c == ';' || c == '\n')) ||
    (valid[COMMENT] && c == '#') ||
    (valid[BLOCK_CLOSE] && c == '}') ||
    (valid[ADDRESS_MODIFIER] && (c == 'I' || c == 'M'));
  if (!content) {
    if (s->mode == FLAGS) {
      if (command_end) {
        s->mode = NORMAL;
        return marked(lexer, valid, COMMAND_END);
      }
    } else {
      if (
        valid[ADDRESS_GAP] &&
        !lexer->eof(lexer) &&
        (!valid[REGEX_START] || (c != '$' && c != '+' && c != '~'))
      )
        return marked(lexer, valid, ADDRESS_GAP);
      if (valid[COMMAND_END])
        return marked(
          lexer,
          valid,
          command_end ? COMMAND_END : MISSING_SEPARATOR
        );
      if (command_end && missing(lexer, s, valid)) return true;
    }
  }
  return emit(lexer, valid, BLANK);
}
static inline bool scan_normal(TSLexer *lexer, Scanner *s, const bool *valid) {
  bool skipped = false;
  if (!valid[PATTERN_START] && !valid[TRANSLATION_START]) {
    if (blank(lexer->lookahead) && !valid[DIRECTIVE])
      return scan_layout(lexer, s, valid);
    skipped = skip_blanks(lexer);
  }
  lexer->mark_end(lexer);
  bool shell = valid[SHELL_START] || valid[INLINE_SHELL_START];
  if (
    valid[TEXT_START] ||
    valid[INLINE_TEXT_START] ||
    (shell && !lexer->eof(lexer) && lexer->lookahead != '\n')
  ) {
    if (lexer->eof(lexer)) return missing(lexer, s, valid);
    enum TokenType token = shell ? INLINE_SHELL_START : INLINE_TEXT_START;
    bool leadin = false;
    if (lexer->lookahead == '\\') {
      token = shell ? SHELL_START : TEXT_START;
      advance(lexer);
      leadin = lexer->lookahead == '\\';
      if (lexer->lookahead == '\n') advance(lexer);
    }
    s->mode = shell ? SHELL : TEXT;
    finish_token(lexer);
    s->raw_text = raw_text(lexer, s, leadin);
    return marked(lexer, valid, token);
  }
  if (
    valid[SEPARATOR] && (lexer->lookahead == ';' || lexer->lookahead == '\n')
  ) {
    advance(lexer);
    return emit(lexer, valid, SEPARATOR);
  }
  if ((valid[COMMENT] || valid[DIRECTIVE]) && lexer->lookahead == '#') {
    bool first = valid[DIRECTIVE] && !skipped;
    advance(lexer);
    enum TokenType token =
      first && lexer->lookahead == 'n' ? DIRECTIVE : COMMENT;
    if (token == DIRECTIVE) advance(lexer);
    else
      while (
        !lexer->eof(lexer) &&
        lexer->lookahead != '\n' &&
        decoded(lexer->lookahead)
      )
        advance(lexer);
    s->mode = COMMENT_TEXT;
    return emit(lexer, valid, token);
  }
  if (valid[EMPTY_LABEL] && lexer->lookahead == 0 && !lexer->eof(lexer)) {
    s->mode = LABEL_TEXT;
    advance(lexer);
    return emit(lexer, valid, EMPTY_LABEL);
  }
  if (valid[EMPTY_FILENAME] && lexer->lookahead == 0 && !lexer->eof(lexer)) {
    s->mode = FILE_NAME;
    advance(lexer);
    return emit(lexer, valid, EMPTY_FILENAME);
  }
  if (valid[FILENAME] || valid[LABEL] || valid[VERSION]) {
    if (
      lexer->eof(lexer) ||
      lexer->lookahead == '\n' ||
      ((valid[LABEL] || valid[VERSION]) && word_separator(lexer->lookahead))
    ) {
      if (missing(lexer, s, valid)) return true;
    } else {
      s->mode = valid[FILENAME] ? FILE_NAME
        : valid[LABEL]          ? LABEL_TEXT
                                : VERSION_TEXT;
      return scan_opaque(lexer, s, valid);
    }
  }
  if (
    !lexer->eof(lexer) &&
    !decoded(lexer->lookahead) &&
    valid[INVALID_ENCODING] &&
    !valid[COMMAND_END]
  )
    return invalid_encoding(lexer, NULL, valid);
  enum TokenType start = valid[PATTERN_START] ? PATTERN_START
    : valid[TRANSLATION_START]                ? TRANSLATION_START
                                              : REGEX_START;
  if (
    valid[start] &&
    (start != REGEX_START ||
      lexer->lookahead == '/' ||
      lexer->lookahead == '\\')
  ) {
    if (lexer->eof(lexer) || lexer->lookahead == '\n')
      return missing(lexer, s, valid);
    if (start == REGEX_START && lexer->lookahead == '\\') {
      advance(lexer);
      if (
        lexer->eof(lexer) ||
        !decoded(lexer->lookahead) ||
        lexer->lookahead == 0 ||
        lexer->lookahead == '\n' ||
        lexer->lookahead > 127
      )
        return emit(lexer, valid, INVALID_ADDRESS_PREFIX);
    }
    if (
      lexer->lookahead == 0 ||
      lexer->lookahead == '\n' ||
      lexer->lookahead > 127
    ) {
      advance(lexer);
      return emit(lexer, valid, INVALID_DELIMITER);
    }
    s->delimiter = lexer->lookahead;
    advance(lexer);
    s->mode = start == REGEX_START ? ADDRESS
      : start == PATTERN_START     ? PATTERN
                                   : SOURCE;
    reset_regex(s);
    return emit(lexer, valid, start);
  }
  if (
    valid[INVALID_DELIMITER] && !lexer->eof(lexer) && lexer->lookahead != '\n'
  ) {
    advance(lexer);
    return emit(lexer, valid, INVALID_DELIMITER);
  }
  if (s->mode == FLAGS) {
    if (!lexer->eof(lexer) && !decoded(lexer->lookahead))
      return invalid_encoding(lexer, NULL, valid);
    enum TokenType token = UNKNOWN_FLAG;
    int32_t c = lexer->lookahead;
    if (c == 'g') token = GLOBAL_FLAG;
    else if (c == 'p') token = PRINT_FLAG;
    else if (c == 'e') token = EVALUATE_FLAG;
    else if (c == 'i' || c == 'I' || c == 'm' || c == 'M') token = MATCH_FLAG;
    else if (c == 'w') {
      token = WRITE_FLAG;
      s->mode = NORMAL;
    } else if (digit(c)) {
      bool zero = true;
      do {
        zero = zero && lexer->lookahead == '0';
        advance(lexer);
      } while (digit(lexer->lookahead));
      return emit(
        lexer,
        valid,
        !zero                  ? OCCURRENCE
          : !lexer->eof(lexer) ? ZERO_OCCURRENCE
                               : PENDING_ZERO
      );
    } else if (
      lexer->eof(lexer) || c == '\n' || c == ';' || c == '}' || c == '#'
    ) {
      s->mode = NORMAL;
      return marked(lexer, valid, COMMAND_END);
    }
    advance(lexer);
    return emit(lexer, valid, token);
  }
  if (
    valid[ADDRESS_MODIFIER] &&
    (lexer->lookahead == 'I' || lexer->lookahead == 'M')
  ) {
    advance(lexer);
    return emit(lexer, valid, ADDRESS_MODIFIER);
  }
  if ((valid[NUMBER] || valid[ZERO_NUMBER]) && digit(lexer->lookahead)) {
    bool zero = true;
    do {
      zero = zero && lexer->lookahead == '0';
      advance(lexer);
    } while (digit(lexer->lookahead));
    lexer->mark_end(lexer);
    return marked(
      lexer,
      valid,
      !zero                   ? NUMBER
        : valid[PENDING_ZERO] ? zero_address(lexer, valid[FIRST_ADDRESS_GAP])
                              : ZERO_NUMBER
    );
  }
  if (valid[FIRST_ADDRESS_GAP] && lexer->lookahead == ',')
    return marked(lexer, valid, FIRST_ADDRESS_GAP);
  if (
    valid[ADDRESS_GAP] &&
    !lexer->eof(lexer) &&
    (!valid[REGEX_START] ||
      (lexer->lookahead != '$' &&
        lexer->lookahead != '+' &&
        lexer->lookahead != '~'))
  )
    return marked(lexer, valid, ADDRESS_GAP);
  if (valid[COMMAND_END]) {
    if (
      lexer->eof(lexer) ||
      lexer->lookahead == '\n' ||
      lexer->lookahead == ';' ||
      lexer->lookahead == '}' ||
      lexer->lookahead == '#'
    )
      return marked(lexer, valid, COMMAND_END);
    return marked(lexer, valid, MISSING_SEPARATOR);
  }
  if (valid[BLOCK_CLOSE] && lexer->lookahead == '}') {
    advance(lexer);
    return emit(lexer, valid, BLOCK_CLOSE);
  }
  if (!lexer->eof(lexer) && !decoded(lexer->lookahead))
    return invalid_encoding(lexer, regex_mode(s) ? s : NULL, valid);
  if (!lexer->eof(lexer) && lexer->lookahead == 0 && valid[NUL_COMMAND]) {
    advance(lexer);
    return emit(lexer, valid, NUL_COMMAND);
  }
  return missing(lexer, s, valid);
}
static inline bool scan(void *payload, TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL]) return false;
  LookaheadLexer ahead = {
    .lexer =
      {
        .lookahead = lexer->lookahead,
        .advance = lookahead_advance,
        .mark_end = lookahead_mark,
        .eof = lookahead_eof,
      },
    .input = lexer,
  };
  TSLexer *input = lexer;
  lexer = &ahead.lexer;
  Scanner next = *(Scanner *)payload;
  bool result = next.mode >= FILE_NAME ? scan_opaque(lexer, &next, valid)
    : regex_mode(&next)                ? scan_regex(lexer, &next, valid)
    : next.mode != NORMAL && next.mode != FLAGS
    ? scan_operand(lexer, &next, valid)
    : scan_normal(lexer, &next, valid);
  if (result) {
    *(Scanner *)payload = next;
    input->result_symbol = lexer->result_symbol;
  }
  return result;
}
static inline unsigned serialize(void *payload, char *buffer) {
  const Scanner *s = payload;
  buffer[0] = (char)s->mode;
  buffer[1] = (char)s->bracket;
  buffer[2] = (char)s->term;
  buffer[3] = (char)(s->interval |
    (s->branch_start << 1) |
    (s->atom << 2) |
    (s->interval_content << 3) |
    (s->verbatim << 4) |
    (s->misplaced_class << 5) |
    (s->boundary_atom << 6) |
    (s->raw_text << 7));
  for (unsigned i = 0; i < 4; i++) {
    buffer[4 + i] = (char)((uint32_t)s->delimiter >> (i * 8));
    buffer[8 + i] = (char)(s->groups >> (i * 8));
  }
  buffer[12] = (char)s->utf8_remaining;
  buffer[13] = (char)s->term_stage;
  buffer[14] = (char)s->host_bracket;
  buffer[15] = (char)s->host_term;
  buffer[16] = (char)(s->host_escaped |
    (s->host_term_closing << 1) |
    (s->host_control << 2));
  return 17;
}
static inline void
deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = payload;
  memset(s, 0, sizeof(*s));
  if (length != 17) return;
  s->host_bracket = (uint8_t)buffer[14];
  s->host_term = (uint8_t)buffer[15];
  s->host_escaped = buffer[16] & 1;
  s->host_control = buffer[16] & 4;
  s->host_term_closing = buffer[16] & 2;
  s->utf8_remaining = (uint8_t)buffer[12];
  s->term_stage = (uint8_t)buffer[13];
  s->mode = (uint8_t)buffer[0];
  s->bracket = (uint8_t)buffer[1];
  s->term = (uint8_t)buffer[2];
  s->interval = buffer[3] & 1;
  s->branch_start = buffer[3] & 2;
  s->atom = buffer[3] & 4;
  s->interval_content = buffer[3] & 8;
  s->verbatim = buffer[3] & 16;
  s->misplaced_class = buffer[3] & 32;
  s->boundary_atom = buffer[3] & 64;
  s->raw_text = buffer[3] & 128;
  uint32_t delimiter = 0;
  for (unsigned i = 0; i < 4; i++) {
    delimiter |= (uint32_t)(uint8_t)buffer[4 + i] << (i * 8);
    s->groups |= (uint32_t)(uint8_t)buffer[8 + i] << (i * 8);
  }
  s->delimiter = (int32_t)delimiter;
}
#endif
