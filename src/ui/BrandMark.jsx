import React from 'react';
import './brand-mark.css';

// Decorative mark beside the product name; the approved SVG also supplies the
// native application icon and welcome animation's final identity.
export default function BrandMark({ small = false }) {
  return <img className={`brand-mark brand-mark-art${small ? ' small' : ''}`} src="./brand/mark.svg" alt="" aria-hidden="true" />;
}
