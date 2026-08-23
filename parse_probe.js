/* Can the parser actually read a resume in each of the twelve languages?
   The UI can be translated perfectly and the app would still be useless if
   the section headings are not recognised, because everything downstream
   keys off the category of a line. */
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const vc=new VirtualConsole();
const dom=new JSDOM(fs.readFileSync('work.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'https://x.test/'});
const CV = {
  he:['יוסי כהן','ניסיון תעסוקתי','מנהל מחסן, טמפו, 2019-2024','ניהלתי צוות של שנים עשר עובדים','כישורים','ניהול מלאי, SAP','השכלה','תואר ראשון בלוגיסטיקה'],
  en:['John Cohen','Work experience','Warehouse manager, Tempo, 2019-2024','Managed a team of twelve staff','Skills','Inventory control, SAP','Education','BA in Logistics'],
  ru:['Иван Петров','Опыт работы','Начальник склада, Темпо, 2019-2024','Руководил командой из двенадцати человек','Навыки','Управление запасами, SAP','Образование','Бакалавр логистики'],
  fr:['Jean Dupont','Expérience professionnelle','Responsable d\'entrepôt, Tempo, 2019-2024','J\'ai géré une équipe de douze personnes','Compétences','Gestion des stocks, SAP','Formation','Licence en logistique'],
  es:['Juan Pérez','Experiencia laboral','Jefe de almacén, Tempo, 2019-2024','Dirigí un equipo de doce personas','Habilidades','Control de inventario, SAP','Educación','Grado en Logística'],
  de:['Hans Müller','Berufserfahrung','Lagerleiter, Tempo, 2019-2024','Ich leitete ein Team von zwölf Mitarbeitern','Kenntnisse','Bestandsführung, SAP','Ausbildung','Bachelor in Logistik'],
  it:['Marco Rossi','Esperienza professionale','Responsabile di magazzino, Tempo, 2019-2024','Ho gestito una squadra di dodici persone','Competenze','Gestione delle scorte, SAP','Istruzione','Laurea in Logistica'],
  pt:['João Silva','Experiência profissional','Gerente de armazém, Tempo, 2019-2024','Gerenciei uma equipe de doze pessoas','Habilidades','Controle de estoque, SAP','Formação','Bacharel em Logística'],
  hr:['Ivan Horvat','Radno iskustvo','Voditelj skladišta, Tempo, 2019-2024','Vodio sam tim od dvanaest ljudi','Vještine','Upravljanje zalihama, SAP','Obrazovanje','Prvostupnik logistike'],
  ar:['يوسف أحمد','الخبرة العملية','مدير مستودع، تيمبو، 2019-2024','أدرت فريقًا من اثني عشر موظفًا','المهارات','إدارة المخزون، SAP','التعليم','بكالوريوس في اللوجستيات'],
  ja:['田中太郎','職務経歴','倉庫マネージャー、テンポ、2019-2024','十二名のチームを管理しました','スキル','在庫管理、SAP','学歴','物流学士'],
  hi:['राहुल शर्मा','कार्य अनुभव','गोदाम प्रबंधक, टेम्पो, 2019-2024','मैंने बारह लोगों की टीम का नेतृत्व किया','कौशल','सूची प्रबंधन, SAP','शिक्षा','लॉजिस्टिक्स में स्नातक']
};
setTimeout(()=>{
  const w=dom.window;
  console.log('lang | sections found                        | verdict');
  console.log('-----+---------------------------------------+--------');
  let broken=[];
  Object.keys(CV).forEach(code=>{
    const doc=w.parseResume(CV[code].join('\n'));
    const cats=[...new Set((doc.lines||[]).map(l=>l.cat))].filter(c=>c&&c!=='other');
    const want=['experience','skills','education'];
    const got=want.filter(c=>cats.indexOf(c)!==-1);
    const ok=got.length===3;
    if(!ok) broken.push(code);
    console.log(' ' + code.padEnd(3) + ' | ' + cats.join(', ').padEnd(37).slice(0,37) + ' | ' + (ok?'OK':'MISSING ' + want.filter(c=>got.indexOf(c)===-1).join(',')));
  });
  console.log('\nparsed correctly: ' + (Object.keys(CV).length-broken.length) + '/' + Object.keys(CV).length);
  if(broken.length) console.log('cannot be parsed: ' + broken.join(', '));

  console.log('\nsecond probe: is there anything for the rewrite to work on');
  console.log('lang | editable | title kept | verdict');
  console.log('-----+----------+------------+--------');
  let bad2=[];
  Object.keys(CV).forEach(code=>{
    const doc=w.parseResume(CV[code].join('\n'));
    const ed=(w.editableLines?w.editableLines(doc):[]).length;
    /* the line that names the job and the employer must NOT be editable: it is
       fact, and a rewrite there is fabrication */
    const titleLine=(doc.lines||[]).filter(l=>/Tempo|טמפו|Темпо|تيمبو|テンポ|टेम्पो/.test(l.text))[0];
    const titleSafe = titleLine ? !titleLine.editable : false;
    const ok = ed>0 && titleSafe;
    if(!ok) bad2.push(code);
    console.log(' '+code.padEnd(3)+' | '+String(ed).padStart(8)+' | '+String(titleSafe).padStart(10)+' | '+(ok?'OK':'PROBLEM'));
  });
  console.log('\nusable: '+(Object.keys(CV).length-bad2.length)+'/'+Object.keys(CV).length);
  if(bad2.length) console.log('problems in: '+bad2.join(', '));
},1600);
