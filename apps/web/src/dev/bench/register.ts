import { createElement } from 'react';
import { registerDevRoute } from '../../shell/routes';
import { RecordBench } from './RecordBench';

registerDevRoute({ path: '/dev/bench', title: 'the record bench', audience: 'staff', nav: false, render: () => createElement(RecordBench) });
