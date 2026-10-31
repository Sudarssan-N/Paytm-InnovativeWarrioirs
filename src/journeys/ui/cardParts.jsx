import React from 'react';

export const Row = ({ label, value, sub, strong }) => (
  <div className="j-row">
    <span className="j-row-label">{label}</span>
    <span className="j-row-value"><span className={strong ? 'is-strong' : ''}>{value}</span>{sub && <small>{sub}</small>}</span>
  </div>
);

export const Foot = ({ children = 'MITRA explains. You decide. Nothing is signed here.' }) => <p className="j-card-foot">{children}</p>;
