import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSpring, createSpringMotion } from '../assets/js/spring-motion.js';

test('viewport spring approaches its target without bouncing from rest', () => {
  for (const target of [-800,800]) {
    let last=0;
    for (let i=1;i<=120;i++) {
      const current=stepSpring(0,0,target,i/60).value;
      assert(Math.abs(target-current)<=Math.abs(target-last));
      assert(current/target>=0 && current/target<=1);
      last=current;
    }
    assert(Math.abs(last-target)<.01);
  }
});

test('the same elapsed time gives the same motion at different frame rates', () => {
  const whole=stepSpring(30,-80,500,.5);
  let split={value:30,velocity:-80};
  for (let i=0;i<30;i++) split=stepSpring(split.value,split.velocity,500,1/60);
  assert(Math.abs(whole.value-split.value)<1e-8);
  assert(Math.abs(whole.velocity-split.velocity)<1e-8);
});

function scene() {
  let now=0,serial=0;
  const frames=new Map();
  const motion=createSpringMotion({clock:()=>now,request:fn=>{frames.set(++serial,fn);return serial;},cancel:id=>frames.delete(id)});
  const advance=milliseconds=>{
    now+=milliseconds;
    const callbacks=[...frames.values()];frames.clear();
    callbacks.forEach(fn=>fn(now));
  };
  return {motion,advance,frames};
}

test('a quick tap retargets from the current picture and preserves its velocity', () => {
  const {motion,advance}=scene();
  let value=0;
  const update=next=>{value=next;};
  motion.start({from:0,to:500,update});advance(100);
  const before=value;
  motion.pause(); // Pointer down pauses; a tap is distinct from a drag.
  motion.start({from:before,to:800,update});
  assert.equal(value,before,'retarget must not jump at the start');
  advance(1);
  assert(value>stepSpring(before,0,800,.001).value,'momentum must survive the tap');
  advance(1800);assert.equal(value,800);
});

test('manual scrolling cancels pending frames and their momentum', () => {
  const {motion,advance,frames}=scene();
  let value=0;
  const update=next=>{value=next;};
  motion.start({from:0,to:800,update});advance(100);
  motion.cancel();const stopped=value;
  advance(1000);assert.equal(value,stopped);assert.equal(frames.size,0);
  motion.start({from:stopped,to:100,update});advance(100);
  assert(Math.abs(value-stepSpring(stopped,0,100,.1).value)<1e-8);
});

test('a long background-frame gap settles exactly without replaying old frames', () => {
  const {motion,advance,frames}=scene();
  let value=0;
  motion.start({from:0,to:900,update:next=>{value=next;}});
  advance(60000);assert.equal(value,900);assert.equal(frames.size,0);
});
