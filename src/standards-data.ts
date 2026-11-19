// Generated from standards.json by scripts/embed-standards.mjs. Edit standards.json, never this file.
const data = {
  "$comment": "Every figure of faxforagents-fax-time, with the sentence or table cell of the standard it is read from. src/standards.ts reads each figure out of its quote and refuses to load when a quote no longer says it. The code words are Tables 2 and 3a of ITU-T T.4 (07/03), in order: terminating codes for run lengths 0 to 63, make-up codes for 64 to 1728 in steps of 64. Table 3b and Table 4 are what the TIFF reader decodes with, never what the coder encodes.",
  "texts": {
    "t-4": {
      "label": "ITU-T T.4",
      "edition": "T.4 (07/03)",
      "title": "Standardization of Group 3 facsimile terminals for document transmission",
      "status": "In force",
      "approved": "2003-07-14",
      "url": "https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-T.4-200307-I!!PDF-E&type=items",
      "read": "2026-11-19"
    },
    "t-30": {
      "label": "ITU-T T.30",
      "edition": "T.30 (09/05)",
      "title": "Procedures for document facsimile transmission in the general switched telephone network",
      "status": "In force",
      "approved": "2005-09-13",
      "url": "https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-T.30-200509-I!!PDF-E&type=items",
      "read": "2026-11-19"
    },
    "rfc-3949": {
      "label": "RFC 3949",
      "edition": "RFC 3949",
      "title": "File Format for Internet Fax",
      "status": "Draft Standard",
      "approved": "February 2005",
      "url": "https://www.rfc-editor.org/rfc/rfc3949.html",
      "read": "2026-11-19"
    }
  },
  "modems": {
    "v-27ter": {
      "label": "ITU-T V.27ter",
      "edition": "V.27ter (11/88)",
      "title": "4800/2400 bits per second modem standardized for use in the general switched telephone network",
      "url": "https://www.itu.int/rec/T-REC-V.27ter-198811-I/en",
      "read": "2026-11-19"
    },
    "v-29": {
      "label": "ITU-T V.29",
      "edition": "V.29 (11/88)",
      "title": "9600 bits per second modem standardized for use on point-to-point 4-wire leased telephone-type circuits",
      "url": "https://www.itu.int/rec/T-REC-V.29-198811-I/en",
      "read": "2026-11-19"
    },
    "v-17": {
      "label": "ITU-T V.17",
      "edition": "V.17 (02/91)",
      "title": "A 2-wire modem for facsimile applications with rates up to 14 400 bit/s",
      "url": "https://www.itu.int/rec/T-REC-V.17-199102-I/en",
      "read": "2026-11-19"
    },
    "v-34": {
      "label": "ITU-T V.34",
      "edition": "V.34 (02/98)",
      "title": "A modem operating at data signalling rates of up to 33 600 bit/s for use on the general switched telephone network and on leased point-to-point 2-wire telephone-type circuits",
      "url": "https://www.itu.int/rec/T-REC-V.34-199802-I/en",
      "read": "2026-11-19"
    }
  },
  "quotes": {
    "t4-width-1728": {
      "text": "t-4",
      "clause": "2.1 c)",
      "says": "c) 1728 black and white picture elements along the standard scan line length of 215 mm ±1%;"
    },
    "t4-standard": {
      "text": "t-4",
      "clause": "2.1 a)",
      "says": "a) a standard resolution of 3.85 lines/mm ± 1% in vertical resolution;"
    },
    "t4-higher": {
      "text": "t-4",
      "clause": "2.1 b)",
      "says": "b) optional higher resolution of 7.7 lines/mm ± 1% and 15.4 lines/mm ± 1% in vertical direction;"
    },
    "t4-total-line": {
      "text": "t-4",
      "clause": "3",
      "says": "The total coded scan line is defined as the sum of data bits plus any required fill bits plus the end-of-line (EOL) bits."
    },
    "t4-scan-standard": {
      "text": "t-4",
      "clause": "3",
      "says": "To handle various printing methods, several optional minimum total coded scan line times are possible in addition to the 20 milliseconds standard."
    },
    "t4-alternative-1": {
      "text": "t-4",
      "clause": "3.1",
      "says": "1) Alternative 1, where the minimum transmission time of the total coded scan line is the same both for the standard resolution and for the optional higher resolution:"
    },
    "t4-scan-20": {
      "text": "t-4",
      "clause": "3.1",
      "says": "a) 20 milliseconds recommended standard;"
    },
    "t4-scan-10": {
      "text": "t-4",
      "clause": "3.1",
      "says": "b) 10 milliseconds recognized option with a mandatory fall-back to the 20 milliseconds standard;"
    },
    "t4-scan-5": {
      "text": "t-4",
      "clause": "3.1",
      "says": "c) 5 milliseconds recognized option with a mandatory fall-back to the 10 milliseconds option and the 20 milliseconds standard;"
    },
    "t4-scan-0": {
      "text": "t-4",
      "clause": "3.1",
      "says": "d) 0 millisecond recognized option with a mandatory fall-back to the 5 milliseconds option, the 10 milliseconds option and the 20 milliseconds standard, and an optional fall-back to the 40 milliseconds option;"
    },
    "t4-scan-40": {
      "text": "t-4",
      "clause": "3.1",
      "says": "e) 40 milliseconds recognized option."
    },
    "t4-phase-b": {
      "text": "t-4",
      "clause": "3.1",
      "says": "The identification and choice of this minimum transmission time is to be made in the pre-message (phase B) portion of T.30 control procedure."
    },
    "t4-ecm-hdlc": {
      "text": "t-4",
      "clause": "3.3",
      "says": "For the optional error correction mode, an HDLC frame structure is utilized to transmit the total coded scan line."
    },
    "t4-line": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "A total of 1728 picture elements represent one horizontal scan line of 215 mm length."
    },
    "t4-white-first": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "In order to ensure that the receiver maintains colour synchronization, all data lines will begin with a white run length code word."
    },
    "t4-black-start": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "If the actual scan line begins with a black run, a white run length of zero will be sent."
    },
    "t4-terminating": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "Run lengths in the range of 0 to 63 pels are encoded with their appropriate terminating code word."
    },
    "t4-make-up": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "Run lengths in the range of 64 to 1728 pels are encoded first by the make-up code word representing the run length which is equal to or shorter than that required."
    },
    "t4-difference": {
      "text": "t-4",
      "clause": "4.1.1",
      "says": "This is then followed by the terminating code word representing the difference between the required run length and the run length represented by the make-up code."
    },
    "t4-eol-follows": {
      "text": "t-4",
      "clause": "4.1.2",
      "says": "This code word follows each line of data."
    },
    "t4-eol-first": {
      "text": "t-4",
      "clause": "4.1.2",
      "says": "In addition, this signal will occur prior to the first data line of a page."
    },
    "t4-eol-format": {
      "text": "t-4",
      "clause": "4.1.2",
      "says": "Format: 000000000001"
    },
    "t4-fill": {
      "text": "t-4",
      "clause": "4.1.3",
      "says": "Fill must be added to ensure that the transmission time of Data, Fill and EOL is not less than the minimum transmission time of the total coded scan line established in the pre-message control procedure."
    },
    "t4-fill-format": {
      "text": "t-4",
      "clause": "4.1.3",
      "says": "Format: variable length string of 0s."
    },
    "t4-rtc": {
      "text": "t-4",
      "clause": "4.1.4",
      "says": "The end of a document transmission is indicated by sending six consecutive EOLs."
    },
    "t30-ecm-0ms": {
      "text": "t-30",
      "clause": "Table 2, note 8",
      "says": "The optional T.4 error correction mode of operation and IAFD mode require 0 ms of the minimum scan line time capability."
    },
    "t30-v34-ecm": {
      "text": "t-30",
      "clause": "F.3",
      "says": "The use of the Error Correction Mode (ECM) is mandatory for all facsimile messages using the V.34 modulation system."
    },
    "t30-dcs-2400-v27ter": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "2400 bit/s, ITU-T Rec. V.27 ter"
    },
    "t30-dcs-4800-v27ter": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "4800 bit/s, ITU-T Rec. V.27 ter"
    },
    "t30-dcs-9600-v29": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "9600 bit/s, ITU-T Rec. V.29"
    },
    "t30-dcs-7200-v29": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "7200 bit/s, ITU-T Rec. V.29"
    },
    "t30-dcs-14400-v17": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "14 400 bit/s, ITU-T Rec. V.17"
    },
    "t30-dcs-12000-v17": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "12 000 bit/s, ITU-T Rec. V.17"
    },
    "t30-dcs-9600-v17": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "9600 bit/s, ITU-T Rec. V.17"
    },
    "t30-dcs-7200-v17": {
      "text": "t-30",
      "clause": "Table 2, bits 11 to 14, DCS",
      "says": "7200 bit/s, ITU-T Rec. V.17"
    },
    "t30-dcs-20ms": {
      "text": "t-30",
      "clause": "Table 2, bits 21 to 23, DCS",
      "says": "20 ms"
    },
    "t30-dcs-40ms": {
      "text": "t-30",
      "clause": "Table 2, bits 21 to 23, DCS",
      "says": "40 ms"
    },
    "t30-dcs-10ms": {
      "text": "t-30",
      "clause": "Table 2, bits 21 to 23, DCS",
      "says": "10 ms"
    },
    "t30-dcs-5ms": {
      "text": "t-30",
      "clause": "Table 2, bits 21 to 23, DCS",
      "says": "5 ms"
    },
    "t30-dcs-0ms": {
      "text": "t-30",
      "clause": "Table 2, bits 21 to 23, DCS",
      "says": "0 ms"
    },
    "rfc-s-x": {
      "text": "rfc-3949",
      "clause": "3.2.1",
      "says": "In pixels/inch, the allowed values are 200 and 204, which may be treated as equivalent."
    },
    "rfc-s-y": {
      "text": "rfc-3949",
      "clause": "3.2.1",
      "says": "In pixels/inch, the allowed values are 98, 100, 196, and 200; 98 and 100 may be treated as equivalent, and 196 and 200 may be treated as equivalent."
    }
  },
  "rates": [
    {
      "bps": 2400,
      "standards": [
        "v-27ter"
      ],
      "quotes": [
        "t30-dcs-2400-v27ter"
      ]
    },
    {
      "bps": 4800,
      "standards": [
        "v-27ter"
      ],
      "quotes": [
        "t30-dcs-4800-v27ter"
      ]
    },
    {
      "bps": 7200,
      "standards": [
        "v-29",
        "v-17"
      ],
      "quotes": [
        "t30-dcs-7200-v29",
        "t30-dcs-7200-v17"
      ]
    },
    {
      "bps": 9600,
      "standards": [
        "v-29",
        "v-17"
      ],
      "quotes": [
        "t30-dcs-9600-v29",
        "t30-dcs-9600-v17"
      ]
    },
    {
      "bps": 12000,
      "standards": [
        "v-17"
      ],
      "quotes": [
        "t30-dcs-12000-v17"
      ]
    },
    {
      "bps": 14400,
      "standards": [
        "v-17"
      ],
      "quotes": [
        "t30-dcs-14400-v17"
      ],
      "default": true
    },
    {
      "bps": 33600,
      "standards": [
        "v-34"
      ],
      "quotes": [
        "t30-v34-ecm",
        "t30-ecm-0ms",
        "t4-ecm-hdlc"
      ],
      "ecm": true
    }
  ],
  "scanTimes": [
    {
      "ms": 0,
      "quotes": [
        "t4-scan-0",
        "t30-dcs-0ms"
      ]
    },
    {
      "ms": 5,
      "quotes": [
        "t4-scan-5",
        "t30-dcs-5ms"
      ]
    },
    {
      "ms": 10,
      "quotes": [
        "t4-scan-10",
        "t30-dcs-10ms"
      ]
    },
    {
      "ms": 20,
      "quotes": [
        "t4-scan-20",
        "t30-dcs-20ms"
      ],
      "default": true
    },
    {
      "ms": 40,
      "quotes": [
        "t4-scan-40",
        "t30-dcs-40ms"
      ]
    }
  ],
  "codes": {
    "clause": "4.1",
    "white": {
      "terminating": [
        "00110101",
        "000111",
        "0111",
        "1000",
        "1011",
        "1100",
        "1110",
        "1111",
        "10011",
        "10100",
        "00111",
        "01000",
        "001000",
        "000011",
        "110100",
        "110101",
        "101010",
        "101011",
        "0100111",
        "0001100",
        "0001000",
        "0010111",
        "0000011",
        "0000100",
        "0101000",
        "0101011",
        "0010011",
        "0100100",
        "0011000",
        "00000010",
        "00000011",
        "00011010",
        "00011011",
        "00010010",
        "00010011",
        "00010100",
        "00010101",
        "00010110",
        "00010111",
        "00101000",
        "00101001",
        "00101010",
        "00101011",
        "00101100",
        "00101101",
        "00000100",
        "00000101",
        "00001010",
        "00001011",
        "01010010",
        "01010011",
        "01010100",
        "01010101",
        "00100100",
        "00100101",
        "01011000",
        "01011001",
        "01011010",
        "01011011",
        "01001010",
        "01001011",
        "00110010",
        "00110011",
        "00110100"
      ],
      "makeUp": [
        "11011",
        "10010",
        "010111",
        "0110111",
        "00110110",
        "00110111",
        "01100100",
        "01100101",
        "01101000",
        "01100111",
        "011001100",
        "011001101",
        "011010010",
        "011010011",
        "011010100",
        "011010101",
        "011010110",
        "011010111",
        "011011000",
        "011011001",
        "011011010",
        "011011011",
        "010011000",
        "010011001",
        "010011010",
        "011000",
        "010011011"
      ]
    },
    "black": {
      "terminating": [
        "0000110111",
        "010",
        "11",
        "10",
        "011",
        "0011",
        "0010",
        "00011",
        "000101",
        "000100",
        "0000100",
        "0000101",
        "0000111",
        "00000100",
        "00000111",
        "000011000",
        "0000010111",
        "0000011000",
        "0000001000",
        "00001100111",
        "00001101000",
        "00001101100",
        "00000110111",
        "00000101000",
        "00000010111",
        "00000011000",
        "000011001010",
        "000011001011",
        "000011001100",
        "000011001101",
        "000001101000",
        "000001101001",
        "000001101010",
        "000001101011",
        "000011010010",
        "000011010011",
        "000011010100",
        "000011010101",
        "000011010110",
        "000011010111",
        "000001101100",
        "000001101101",
        "000011011010",
        "000011011011",
        "000001010100",
        "000001010101",
        "000001010110",
        "000001010111",
        "000001100100",
        "000001100101",
        "000001010010",
        "000001010011",
        "000000100100",
        "000000110111",
        "000000111000",
        "000000100111",
        "000000101000",
        "000001011000",
        "000001011001",
        "000000101011",
        "000000101100",
        "000001011010",
        "000001100110",
        "000001100111"
      ],
      "makeUp": [
        "0000001111",
        "000011001000",
        "000011001001",
        "000001011011",
        "000000110011",
        "000000110100",
        "000000110101",
        "0000001101100",
        "0000001101101",
        "0000001001010",
        "0000001001011",
        "0000001001100",
        "0000001001101",
        "0000001110010",
        "0000001110011",
        "0000001110100",
        "0000001110101",
        "0000001110110",
        "0000001110111",
        "0000001010010",
        "0000001010011",
        "0000001010100",
        "0000001010101",
        "0000001011010",
        "0000001011011",
        "0000001100100",
        "0000001100101"
      ]
    },
    "eol": "000000000001"
  },
  "decode": {
    "extendedMakeUp": {
      "table": "Table 3b",
      "from": 1792,
      "step": 64,
      "codes": [
        "00000001000",
        "00000001100",
        "00000001101",
        "000000010010",
        "000000010011",
        "000000010100",
        "000000010101",
        "000000010110",
        "000000010111",
        "000000011100",
        "000000011101",
        "000000011110",
        "000000011111"
      ]
    },
    "modes": {
      "table": "Table 4",
      "pass": "0001",
      "horizontal": "001",
      "vertical": {
        "0": "1",
        "1": "011",
        "2": "000011",
        "3": "0000011",
        "-1": "010",
        "-2": "000010",
        "-3": "0000010"
      }
    }
  }
}

export default data
