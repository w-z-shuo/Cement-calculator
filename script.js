function floorToBags(kg, bagKg){
  return Math.floor(kg / bagKg);
}

function formatTons(kg){
  return (kg/1000).toFixed(3).replace(/\.0+$/,'');
}

const appState = {
  palletsRemaining: [],
  bagWeightKg: 0,
  palletWeightKg: 0,
  palletLenM: 0,
  palletWidM: 0,
  totalCementKg: 0,
  remainingCementKg: 0,
  nextPalletIndex: 1,
  nextTruckIndex: 1,
  defaultTruckCapacityTon: undefined
};

function allocateBagsToPallets({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, initialFillPercent, enableRedistribution }){
  const totalCementKg = totalTons * 1000;
  const bagKg = bagWeightKg;
  const totalBags = Math.ceil(totalCementKg / bagKg);

  const dynamicKg = palletDynamicLoadTon * 1000;
  const initialCapKg = dynamicKg * (initialFillPercent/100);
  const maxCargoKg = Math.max(0, initialCapKg - palletWeightKg);
  const maxBagsPerPallet = Math.max(0, floorToBags(maxCargoKg, bagKg));

  if(maxBagsPerPallet<=0){
    return { pallets: [], remainingCementBags: totalBags };
  }

  const fullPalletsCount = Math.floor(totalBags / maxBagsPerPallet);
  let remainderBags = totalBags - fullPalletsCount * maxBagsPerPallet;

  const pallets = [];
  for(let i=0;i<fullPalletsCount;i++){
    pallets.push({ index: i+1, dynamicKg, maxBags: maxBagsPerPallet, bags: maxBagsPerPallet });
  }
  if(remainderBags>0){
    pallets.push({ index: pallets.length+1, dynamicKg, maxBags: maxBagsPerPallet, bags: remainderBags });
  }

  if(enableRedistribution && remainderBags>0 && fullPalletsCount>0){
    const perPallet = Math.ceil(remainderBags / fullPalletsCount);
    if(perPallet < 3){
      const absoluteMaxBags = floorToBags(Math.max(0, dynamicKg - palletWeightKg), bagKg);
      const extraHeadroomPerFull = Math.max(0, absoluteMaxBags - maxBagsPerPallet);
      if(extraHeadroomPerFull>0){
        const movable = Math.min(remainderBags, extraHeadroomPerFull * fullPalletsCount);
        let moved = 0;
        for(let i=0;i<fullPalletsCount;i++){
          if(moved>=movable) break;
          const give = Math.min(perPallet, movable - moved, extraHeadroomPerFull);
          pallets[i].bags += give;
          moved += give;
        }
        remainderBags -= moved;
        const lastIdx = pallets.length-1;
        if(remainderBags===0 && pallets[lastIdx] && pallets[lastIdx].bags < maxBagsPerPallet){
          pallets.pop();
        } else if(pallets[lastIdx] && remainderBags<movable){
          pallets[lastIdx].bags = Math.max(0, pallets[lastIdx].bags - (movable - remainderBags));
          if(pallets[lastIdx].bags===0) pallets.pop();
        }
      }
    }
  }

  return { pallets, remainingCementBags: 0, totalBags };
}

function startSession({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, palletLenM, palletWidM, initialFillPercent, enableRedistribution }){
  const allocation = allocateBagsToPallets({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, initialFillPercent, enableRedistribution });
  appState.palletsRemaining = allocation.pallets.map(p=>({ ...p }));
  appState.bagWeightKg = bagWeightKg;
  appState.palletWeightKg = palletWeightKg;
  appState.palletLenM = palletLenM;
  appState.palletWidM = palletWidM;
  appState.totalCementKg = Math.ceil(totalTons*1000);
  const loadedKg = appState.palletsRemaining.reduce((s,p)=>s + (p.bags*bagWeightKg), 0);
  appState.remainingCementKg = Math.max(0, appState.totalCementKg - loadedKg + 0);
  appState.nextPalletIndex = appState.palletsRemaining.length + 1;
  appState.nextTruckIndex = 1;
}

function palletsWeightKg(p){
  return p.bags*appState.bagWeightKg + appState.palletWeightKg;
}

function maxPalletsByFloor(truckLenM, truckWidM){
  const along = Math.floor(truckLenM / appState.palletLenM);
  const across = Math.floor(truckWidM / appState.palletWidM);
  return Math.max(0, along) * Math.max(0, across);
}

function allocateForTruck({ capTon, lenM, widM, requestedPallets, userMaxLoadTon }){
  const capKgPhysical = capTon * 1000;
  const capKg = Number.isFinite(userMaxLoadTon) && userMaxLoadTon>0 ? Math.min(capKgPhysical, userMaxLoadTon*1000) : capKgPhysical;
  const maxByFloor = maxPalletsByFloor(lenM, widM);
  if(maxByFloor<=0 || capKg<=appState.palletWeightKg){
    return { loaded: [], usedKg: 0 };
  }

  const remaining = appState.palletsRemaining.slice();
  const loaded = [];
  let usedKg = 0;

  for(const p of remaining){
    if(loaded.length>=maxByFloor) break;
    if(Number.isFinite(requestedPallets) && requestedPallets>0 && loaded.length>=requestedPallets) break;
    const w = palletsWeightKg(p);
    if(usedKg + w <= capKg){
      loaded.push(p);
      usedKg += w;
    }
  }

  if(loaded.length < maxByFloor && !(Number.isFinite(requestedPallets) && requestedPallets>0 && loaded.length>=requestedPallets)){
    const already = new Set(loaded.map(x=>x.index));
    const candidates = remaining.filter(p=>!already.has(p.index)).sort((a,b)=>palletsWeightKg(a)-palletsWeightKg(b));
    for(const p of candidates){
      if(loaded.length>=maxByFloor) break;
      if(Number.isFinite(requestedPallets) && requestedPallets>0 && loaded.length>=requestedPallets) break;
      const w = palletsWeightKg(p);
      if(usedKg + w <= capKg){
        loaded.push(p);
        usedKg += w;
      }
    }
  }

  if(loaded.length>0){
    const ids = new Set(loaded.map(x=>x.index));
    appState.palletsRemaining = appState.palletsRemaining.filter(p=>!ids.has(p.index));
  }

  return { loaded, usedKg };
}

function updateRemainingInfo(){
  const infoEl = document.getElementById('remainingInfo');
  const totalBagsLeft = appState.palletsRemaining.reduce((s,p)=>s+p.bags,0);
  const totalKgLeft = appState.palletsRemaining.reduce((s,p)=>s + p.bags*appState.bagWeightKg, 0);
  infoEl.textContent = `总水泥 ${formatTons(appState.totalCementKg)} 吨；剩余 ${totalBagsLeft} 袋，${formatTons(totalKgLeft)} 吨。若未装完，请继续添加车辆。`;
  const section = document.getElementById('trucksSection');
  section.hidden = false;
  const addBtn = document.getElementById('addTruckBtn');
  addBtn.disabled = appState.palletsRemaining.length===0;

  // Bottom message: if still remaining, prompt to add more trucks
  const bottom = document.getElementById('results');
  if(totalKgLeft > 0){
    bottom.innerHTML = `<div class="tag warn">剩余水泥 ${formatTons(totalKgLeft)} 吨，需要增加运输车辆</div>`;
  } else {
    bottom.innerHTML = '';
  }
}

function createTruckFormCard(){
  const listEl = document.getElementById('trucksList');
  const idx = appState.nextTruckIndex++;
  const wrapper = document.createElement('div');
  wrapper.className = 'truck truck-form';
  wrapper.innerHTML = `
    <div><strong>车辆 #${idx}</strong> 输入车辆参数</div>
    <div class="grid">
      <label>车辆载重量（吨）<input type="number" step="0.1" min="0.1" class="t-cap"></label>
      <label>车厢长度（米）<input type="number" step="0.01" min="0.01" class="t-len"></label>
      <label>车厢宽度（米）<input type="number" step="0.01" min="0.01" class="t-wid"></label>
      <label class="inline"><input type="checkbox" class="t-custom-pallets"> 自定义托盘数</label>
      <label><span class="sr-only">自定义托盘数值</span><input type="number" step="1" min="1" class="t-pallet-cnt" placeholder="托盘数" disabled></label>
      <label class="inline"><input type="checkbox" class="t-limit-tons"> 限制本车最多吨位</label>
      <label><span class="sr-only">最多吨位</span><input type="number" step="0.01" min="0.01" class="t-tons-cap" placeholder="最多吨位" disabled></label>
    </div>
    <div class="actions">
      <button type="button" class="do-load">装载本车</button>
    </div>
    <div class="pallets"></div>
  `;
  const capInput = wrapper.querySelector('.t-cap');
  if(Number.isFinite(appState.defaultTruckCapacityTon) && appState.defaultTruckCapacityTon>0){
    capInput.value = String(appState.defaultTruckCapacityTon);
  }
  const customChk = wrapper.querySelector('.t-custom-pallets');
  const customCnt = wrapper.querySelector('.t-pallet-cnt');
  customChk.addEventListener('change', ()=>{
    customCnt.disabled = !customChk.checked;
  });
  const limitChk = wrapper.querySelector('.t-limit-tons');
  const limitCnt = wrapper.querySelector('.t-tons-cap');
  limitChk.addEventListener('change', ()=>{
    limitCnt.disabled = !limitChk.checked;
  });
  const btn = wrapper.querySelector('.do-load');
  btn.addEventListener('click', ()=>{
    const capTon = Number(wrapper.querySelector('.t-cap').value);
    const lenM = Number(wrapper.querySelector('.t-len').value);
    const widM = Number(wrapper.querySelector('.t-wid').value);
    const requestedPallets = customChk.checked ? Number(customCnt.value) : undefined;
    const userMaxLoadTon = limitChk.checked ? Number(limitCnt.value) : undefined;
    if(!(capTon>0 && lenM>0 && widM>0)){
      alert('请填写有效的车辆载重与尺寸');
      return;
    }
    const { loaded, usedKg } = allocateForTruck({ capTon, lenM, widM, requestedPallets, userMaxLoadTon });
    const header = wrapper.firstElementChild;
    const palletsEl = wrapper.querySelector('.pallets');
    const gridEl = wrapper.querySelector('.grid');
    const actionsEl = wrapper.querySelector('.actions');
    gridEl.remove();
    actionsEl.remove();
    if(loaded.length===0){
      header.innerHTML = `<strong>车辆 #${idx}</strong> 未能装载任何托盘（尺寸或载重限制）`;
    } else {
      const loadedBags = loaded.reduce((s,p)=>s+p.bags,0);
      const loadedKg = loadedBags*appState.bagWeightKg + loaded.length*appState.palletWeightKg;
      const reqText = Number.isFinite(requestedPallets) && requestedPallets>0 ? `（自定义托盘数 ${requestedPallets} 个，实际可装托盘数 ${loaded.length} 个）` : '';
      const limitText = Number.isFinite(userMaxLoadTon) && userMaxLoadTon>0 ? `（自定义最大运载量 ${userMaxLoadTon} 吨）` : '';
      header.innerHTML = `<strong>车辆 #${idx}</strong> 本车已装载 ${loaded.length} 个托盘${reqText}，${formatTons(loadedKg)} 吨 ${limitText}`;
      palletsEl.className = 'pallets';
      loaded.forEach((p, i)=>{
        const wKg = p.bags*appState.bagWeightKg + appState.palletWeightKg;
        const div = document.createElement('div');
        div.className = 'pallet';
        div.innerHTML = `托盘 #${i+1}<br>袋数：${p.bags} 袋<br>重量：${formatTons(wKg)} 吨`;
        palletsEl.appendChild(div);
      });
    }
    updateRemainingInfo();
  });
  listEl.appendChild(wrapper);
}

function onSubmit(evt){
  evt.preventDefault();
  const totalTons = Number(document.getElementById('totalTons').value);
  const bagWeightKg = Number(document.getElementById('bagWeightKg').value);
  const palletWeightKg = Number(document.getElementById('palletWeightKg').value);
  const palletDynamicLoadTon = Number(document.getElementById('palletDynamicLoad').value);
  const palletLenM = Number(document.getElementById('palletLenM').value);
  const palletWidM = Number(document.getElementById('palletWidM').value);
  const defaultTruckCapacityTon = Number(document.getElementById('defaultTruckCapacity').value);
  const initialFillPercent = Number(document.getElementById('initialFillPercent').value || 90);
  const enableRedistributionEl = document.getElementById('enableRedistribution');
  const enableRedistribution = enableRedistributionEl ? (enableRedistributionEl.type === 'checkbox' ? enableRedistributionEl.checked : enableRedistributionEl.value !== 'false') : true;

  if(!(totalTons>0 && bagWeightKg>0 && palletWeightKg>=0 && palletDynamicLoadTon>0 && palletLenM>0 && palletWidM>0)){
    alert('请输入有效数据');
    return;
  }

  startSession({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, palletLenM, palletWidM, initialFillPercent, enableRedistribution });
  appState.defaultTruckCapacityTon = Number.isFinite(defaultTruckCapacityTon) && defaultTruckCapacityTon>0 ? defaultTruckCapacityTon : undefined;

  document.getElementById('results').innerHTML = '';
  const listEl = document.getElementById('trucksList');
  listEl.innerHTML = '';
  updateRemainingInfo();
  document.getElementById('addTruckBtn').onclick = ()=>{
    createTruckFormCard();
  };
  createTruckFormCard();
}

document.getElementById('calc-form').addEventListener('submit', onSubmit);
