# Changelog

## 0.1.0

The first version, the coder of the [fax transmission time tool](https://faxforagents.com/tools/fax-time/) as a
package of its own.

- `faxTime` gives the bits and seconds of each page of a TIFF, a PBM or a 1-bit bitmap. `codeFile` and
  `codeBitmap` code the pages once, and `timeFile` and `timePage` time them at any setting.
- The rates are the DCS rates of T.30 Table 2 and 33 600 bit/s of V.34. The minimum scan line times are the five
  options of T.4 3.1.
- `fax-time <file>` prints the seconds of each page. It reads TIFF and PBM. PDF is left for a later version.
- `standards.json` holds the 42 quotes of T.4, T.30 and RFC 3949 that every figure is read from, each with its
  clause.
