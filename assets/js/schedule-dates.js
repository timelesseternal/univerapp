/* Week dates come from this student's academic calendar, never the device week. */
(() => {
  const requests = new Map();
  let revision = 0;
  const buttons = ['ПН','ВТ','СР','ЧТ','ПТ','СБ'];
  const iso = date => date.toISOString().slice(0,10);
  const short = date => `${String(date.getUTCDate()).padStart(2,'0')}.${String(date.getUTCMonth()+1).padStart(2,'0')}`;
  function dates(start, week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(Number(week)) || week < 1 || week > 60) return null;
    const monday = new Date(start+'T00:00:00Z');
    if (!Number.isFinite(monday.getTime()) || iso(monday) !== start) return null;
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7 + (Number(week)-1)*7);
    return Array.from({length:7},(_,index)=>new Date(monday.getTime()+index*86400000));
  }
  function paint(values) {
    buttons.forEach((name,index)=>{
      const button=document.getElementById('btn-'+name);if(!button)return;
      const label=document.createElement('span');label.className='day-name';label.textContent=name;
      const number=document.createElement('span');number.className='day-date';number.textContent=values?String(values[index].getUTCDate()):'—';
      button.replaceChildren(label,number);
      button.setAttribute('aria-label',values?`${name}, ${short(values[index])}.${values[index].getUTCFullYear()}`:name);
    });
    const label=document.getElementById('weekStepLabel');
    label?.querySelector('.week-date-range')?.remove();
    if(label&&values){const range=document.createElement('span');range.className='week-date-range';range.textContent=`${short(values[0])}–${short(values[6])}`;label.append(range);}
  }
  async function render({weekInfo,student,calendar}) {
    const run=++revision;paint(null);
    if(!weekInfo||!student?.studentID||typeof calendar!=='function')return;
    const key=`${student.studentID}:${weekInfo.studyYear}:${weekInfo.term}`;
    if(!requests.has(key))requests.set(key,Promise.resolve().then(calendar).then(data=>{
      if(Number(data?.studentID)!==Number(student.studentID))return null;
      const periods=data.gradingPeriods?.filter(item=>Number(item.studyYear)===Number(weekInfo.studyYear)&&Number(item.term)===Number(weekInfo.term));
      return periods?.length===1?periods[0].periods?.[0]?.start:null;
    }));
    try{const start=await requests.get(key);if(!start){requests.delete(key);return;}if(run===revision)paint(dates(start,weekInfo.week));}
    catch{requests.delete(key);}
  }
  window.unilinkScheduleDates={render,dates,reset(){revision++;requests.clear();paint(null);}};
})();
